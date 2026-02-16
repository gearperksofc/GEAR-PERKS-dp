"use client"

import type React from "react"
import { useState, useEffect, useRef, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { useLanguage } from "@/contexts/language-context"
import { useGame, type Deck, type Card as GameCard } from "@/contexts/game-context"
import { Button } from "@/components/ui/button"
import { ArrowLeft, MessageCircle, Send, X, Swords } from "lucide-react"
import { Input } from "@/components/ui/input"
import Image from "next/image"
import type { RealtimeChannel } from "@supabase/supabase-js"

interface RoomData {
  roomId: string
  roomCode: string
  isHost: boolean
  hostId: string
  hostName: string
  hostDeck: Deck | null
  guestId: string | null
  guestName: string | null
  guestDeck: Deck | null
  hostReady: boolean
  guestReady: boolean
}

interface OnlineDuelScreenProps {
  roomData: RoomData
  onBack: () => void
}

type Phase = "draw" | "main" | "battle" | "end"

interface FieldCard extends GameCard {
  currentDp: number
  canAttack: boolean
  hasAttacked: boolean
  canAttackTurn: number
}

interface FieldState {
  unitZone: (FieldCard | null)[]
  functionZone: (GameCard | null)[]
  equipZone: GameCard | null
  scenarioZone: GameCard | null
  ultimateZone: FieldCard | null
  hand: GameCard[]
  deck: GameCard[]
  graveyard: GameCard[]
  life: number
}

interface DuelAction {
  type: "draw" | "place_card" | "attack" | "end_turn" | "phase_change" | "damage" | "destroy_card" | "place_scenario" | "place_ultimate" | "surrender"
  playerId: string
  data: any
  timestamp: number
}

interface ChatMessage {
  id: string
  sender_id: string
  sender_name: string
  message: string
  created_at: string
}

interface AttackState {
  isAttacking: boolean
  attackerIndex: number | null
  targetInfo?: { type: "unit" | "direct"; index?: number } | null
}

const shuffleArray = <T,>(array: T[]): T[] => {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

const isUltimateCard = (card: GameCard | null): boolean => {
  if (!card) return false
  return card.type === "ultimateGear" || card.type === "ultimateGuardian"
}

const isUnitCard = (card: GameCard | null): boolean => {
  if (!card) return false
  return (
    card.type === "unit" ||
    card.type === "ultimateGear" ||
    card.type === "ultimateGuardian" ||
    card.type === "ultimateElemental"
  )
}

const getElementColors = (element: string): string[] => {
  const el = element?.toLowerCase()
  switch (el) {
    case "aquos":
    case "aquo":
      return ["#00bfff", "#0080ff", "#40e0d0", "#87ceeb", "#00ffff"]
    case "fire":
    case "pyrus":
      return ["#ff4500", "#ff6600", "#ff8c00", "#ffa500", "#ffcc00"]
    case "ventus":
      return ["#32cd32", "#00ff00", "#7cfc00", "#90ee90", "#adff2f"]
    case "darkness":
    case "darkus":
    case "dark":
      return ["#9932cc", "#8b008b", "#4b0082", "#800080", "#9400d3"]
    case "lightness":
    case "haos":
    case "light":
      return ["#ffd700", "#ffff00", "#fffacd", "#fff8dc", "#ffefd5"]
    default:
      return ["#ffffff", "#f0f0f0", "#e0e0e0", "#d0d0d0", "#c0c0c0"]
  }
}

export function OnlineDuelScreen({ roomData, onBack }: OnlineDuelScreenProps) {
  const { t } = useLanguage()
  const { getPlaymatForDeck, addMatchRecord } = useGame()
  const supabase = createClient()

  // Player identification
  const playerId = roomData.isHost ? roomData.hostId : roomData.guestId || ""
  const playerProfile = {
    name: roomData.isHost ? roomData.hostName : roomData.guestName || "Player",
  }

  // Game state
  const [turn, setTurn] = useState(1)
  const [phase, setPhase] = useState<Phase>("draw")
  const [isMyTurn, setIsMyTurn] = useState(roomData.isHost) // Host goes first
  const [gameResult, setGameResult] = useState<"won" | "lost" | null>(null)
  const [winReason, setWinReason] = useState<"surrender" | "combat" | null>(null)

  // Field states
  const [myField, setMyField] = useState<FieldState>({
    unitZone: [null, null, null, null],
    functionZone: [null, null, null, null],
    equipZone: null,
    scenarioZone: null,
    ultimateZone: null,
    hand: [],
    deck: [],
    graveyard: [],
    life: 20,
  })

  const [opponentField, setOpponentField] = useState<FieldState>({
    unitZone: [null, null, null, null],
    functionZone: [null, null, null, null],
    equipZone: null,
    scenarioZone: null,
    ultimateZone: null,
    hand: [],
    deck: [],
    graveyard: [],
    life: 20,
  })

  // UI state
  const [selectedHandCard, setSelectedHandCard] = useState<number | null>(null)
  const [attackState, setAttackState] = useState<AttackState>({
    isAttacking: false,
    attackerIndex: null,
    targetInfo: null,
  })
  const [attackTarget, setAttackTarget] = useState<{ type: "direct" | "unit"; index?: number } | null>(null)
  const [inspectedCard, setInspectedCard] = useState<GameCard | null>(null)
  const [graveyardView, setGraveyardView] = useState<"player" | "enemy" | null>(null)
  const [showChat, setShowChat] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState("")
  const chatContainerRef = useRef<HTMLDivElement>(null)

  // Drag and drop state
  const [draggedHandCard, setDraggedHandCard] = useState<{
    index: number
    card: GameCard
    currentY?: number
  } | null>(null)
  const [dropTarget, setDropTarget] = useState<{ type: "unit" | "function" | "scenario"; index: number } | null>(null)

  // Attack arrow state
  const [arrowPos, setArrowPos] = useState({ x1: 0, y1: 0, x2: 0, y2: 0 })

  // Refs
  const actionsChannelRef = useRef<RealtimeChannel | null>(null)
  const chatChannelRef = useRef<RealtimeChannel | null>(null)
  const fieldRef = useRef<HTMLDivElement>(null)
  const cardPressTimer = useRef<NodeJS.Timeout | null>(null)
  const positionRef = useRef({ startX: 0, startY: 0, currentX: 0, currentY: 0 })
  const gameResultRecordedRef = useRef(false)
  const draggedCardRef = useRef<HTMLDivElement>(null)
  const dragPosRef = useRef({ x: 0, y: 0, rotation: 0, lastCheck: 0 })
  const [droppingCard, setDroppingCard] = useState<{
    card: GameCard
    targetX: number
    targetY: number
  } | null>(null)
  
  // Draw card animation state
  const [drawAnimation, setDrawAnimation] = useState<{
    visible: boolean
    cardName: string
    cardImage: string
    cardType: string
  } | null>(null)
  
  // Helper to show draw card animation
  const showDrawAnimation = useCallback((card: GameCard) => {
    setDrawAnimation({
      visible: true,
      cardName: card.name,
      cardImage: card.image,
      cardType: card.type,
    })
    setTimeout(() => setDrawAnimation(null), 1300)
  }, [])

  // Get my deck and opponent deck
  const myDeck = roomData.isHost ? roomData.hostDeck : roomData.guestDeck
  const opponentDeck = roomData.isHost ? roomData.guestDeck : roomData.hostDeck
  const opponentName = roomData.isHost ? roomData.guestName : roomData.hostName

  // Debug log for deck and turn
  console.log("[v0] === DUEL INIT DEBUG ===")
  console.log("[v0] roomData.isHost:", roomData.isHost)
  console.log("[v0] playerId:", playerId)
  console.log("[v0] roomData.hostDeck:", roomData.hostDeck?.name, "cards:", roomData.hostDeck?.cards?.length)
  console.log("[v0] roomData.guestDeck:", roomData.guestDeck?.name, "cards:", roomData.guestDeck?.cards?.length)
  console.log("[v0] myDeck (computed):", myDeck?.name, "cards:", myDeck?.cards?.length)
  console.log("[v0] opponentDeck (computed):", opponentDeck?.name)
  console.log("[v0] isMyTurn (initial from isHost):", roomData.isHost)

  // Initialize game
  useEffect(() => {
    console.log("[v0] Initialize useEffect running, myDeck:", myDeck?.name)
    if (!myDeck) {
      console.log("[v0] No myDeck found, skipping initialization")
      return
    }

    // Shuffle deck and draw initial hand
    const shuffledDeck = shuffleArray([...myDeck.cards])
    const initialHand = shuffledDeck.slice(0, 5)
    const remainingDeck = shuffledDeck.slice(5)

    console.log("[v0] Setting initial hand with", initialHand.length, "cards")
    console.log("[v0] Initial hand cards:", initialHand.map(c => c.name))

    setMyField((prev) => ({
      ...prev,
      deck: remainingDeck,
      hand: initialHand,
    }))

    // Set opponent initial deck size
    if (opponentDeck) {
      setOpponentField((prev) => ({
        ...prev,
        deck: Array(opponentDeck.cards.length - 5).fill(null),
        hand: Array(5).fill(null),
      }))
    }

    // Subscribe to game actions
    subscribeToActions()
    subscribeToChat()

    // Send initial state to opponent
    sendAction({
      type: "draw",
      playerId,
      data: { handSize: initialHand.length, deckSize: remainingDeck.length },
      timestamp: Date.now(),
    })

    return () => {
      if (actionsChannelRef.current) {
        actionsChannelRef.current.unsubscribe()
      }
      if (chatChannelRef.current) {
        chatChannelRef.current.unsubscribe()
      }
    }
  }, [])

  // Subscribe to game actions
  const subscribeToActions = useCallback(() => {
    console.log("[v0] Subscribing to actions for room:", roomData.roomId)
    const channel = supabase
      .channel(`duel-actions-${roomData.roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "duel_actions",
          filter: `room_id=eq.${roomData.roomId}`,
        },
        (payload) => {
          console.log("[v0] Received action payload:", payload)
          const action = payload.new as any
          console.log("[v0] Action player_id:", action.player_id, "My playerId:", playerId)
          if (action.player_id !== playerId) {
            console.log("[v0] Processing opponent action")
            let actionData = action.action_data
            if (typeof actionData === "string") {
              try {
                actionData = JSON.parse(actionData)
              } catch {
                // Keep as is if parsing fails
              }
            }
            handleOpponentAction(actionData)
          } else {
            console.log("[v0] Skipping own action")
          }
        }
      )
      .subscribe()

    actionsChannelRef.current = channel
  }, [supabase, roomData.roomId, playerId])

  // Subscribe to chat
  const subscribeToChat = useCallback(() => {
    const loadMessages = async () => {
      const { data } = await supabase
        .from("duel_chat")
        .select("*")
        .eq("room_id", roomData.roomId)
        .order("created_at", { ascending: true })

      if (data) {
        setChatMessages(data)
      }
    }
    loadMessages()

    const channel = supabase
      .channel(`duel-chat-${roomData.roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "duel_chat",
          filter: `room_id=eq.${roomData.roomId}`,
        },
        (payload) => {
          setChatMessages((prev) => [...prev, payload.new as ChatMessage])
        }
      )
      .subscribe()

    chatChannelRef.current = channel
  }, [supabase, roomData.roomId])

  // Send action to database
  const sendAction = useCallback(async (action: DuelAction) => {
    console.log("[v0] Sending action:", action.type, action)
    
    // Get the next sequence number for this room
    const { data: seqData } = await supabase.rpc('get_next_action_sequence', { 
      p_room_id: roomData.roomId 
    })
    const sequenceNumber = seqData || 1
    
    const { error } = await supabase.from("duel_actions").insert({
      room_id: roomData.roomId,
      player_id: playerId,
      action_type: action.type,
      action_data: JSON.stringify(action),
      sequence_number: sequenceNumber,
    })
    if (error) {
      console.error("[v0] Error sending action:", error)
    } else {
      console.log("[v0] Action sent successfully with sequence:", sequenceNumber)
    }
  }, [supabase, roomData.roomId, playerId])

  // Handle opponent's action
  const handleOpponentAction = (action: DuelAction) => {
    console.log("[v0] Received opponent action:", action.type, action)
    
    switch (action.type) {
      case "draw":
        setOpponentField((prev) => ({
          ...prev,
          hand: Array(action.data.handSize).fill(null),
          deck: Array(action.data.deckSize).fill(null),
        }))
        break

      case "place_card":
        if (action.data.zone === "unit") {
          setOpponentField((prev) => {
            const newUnitZone = [...prev.unitZone]
            const cardData = action.data.card
            newUnitZone[action.data.index] = {
              ...cardData,
              currentDp: cardData.dp,
              canAttack: false,
              hasAttacked: false,
              canAttackTurn: turn,
            }
            return {
              ...prev,
              unitZone: newUnitZone,
              hand: prev.hand.slice(0, -1),
            }
          })
        } else if (action.data.zone === "function") {
          setOpponentField((prev) => {
            const newFunctionZone = [...prev.functionZone]
            newFunctionZone[action.data.index] = action.data.card
            return {
              ...prev,
              functionZone: newFunctionZone,
              hand: prev.hand.slice(0, -1),
            }
          })
        }
        break

      case "place_scenario":
        setOpponentField((prev) => ({
          ...prev,
          scenarioZone: action.data.card,
          hand: prev.hand.slice(0, -1),
        }))
        break

      case "place_ultimate":
        setOpponentField((prev) => {
          const cardData = action.data.card
          return {
            ...prev,
            ultimateZone: {
              ...cardData,
              currentDp: cardData.dp,
              canAttack: false,
              hasAttacked: false,
              canAttackTurn: turn,
            },
            hand: prev.hand.slice(0, -1),
          }
        })
        break

      case "attack":
        const { attackerIndex, targetType, targetIndex, damage } = action.data

        if (targetType === "direct") {
          setMyField((prev) => ({
            ...prev,
            life: Math.max(0, prev.life - damage),
          }))
        } else if (targetType === "unit") {
          setMyField((prev) => {
            const newUnitZone = [...prev.unitZone]
            const newGraveyard = [...prev.graveyard]
            const target = newUnitZone[targetIndex]
            if (target) {
              target.currentDp -= damage
              if (target.currentDp <= 0) {
                newGraveyard.push(target)
                newUnitZone[targetIndex] = null
              }
            }
            return { ...prev, unitZone: newUnitZone, graveyard: newGraveyard }
          })

          // Attacker also takes damage from defender
          setOpponentField((prev) => {
            const newUnitZone = [...prev.unitZone]
            const newGraveyard = [...prev.graveyard]
            const attacker = newUnitZone[attackerIndex]
            if (attacker && action.data.counterDamage) {
              attacker.currentDp -= action.data.counterDamage
              if (attacker.currentDp <= 0) {
                newGraveyard.push(attacker)
                newUnitZone[attackerIndex] = null
              }
            }
            return { ...prev, unitZone: newUnitZone, graveyard: newGraveyard }
          })
        }

        // Mark attacker as having attacked
        setOpponentField((prev) => {
          const newUnitZone = [...prev.unitZone]
          const attacker = newUnitZone[attackerIndex]
          if (attacker) {
            attacker.hasAttacked = true
            attacker.canAttack = false
          }
          return { ...prev, unitZone: newUnitZone }
        })
        break

      case "damage":
        if (action.data.target === "player") {
          setMyField((prev) => ({
            ...prev,
            life: Math.max(0, prev.life - action.data.amount),
          }))
        }
        break

      case "end_turn":
        console.log("[v0] Received end_turn action from opponent")
        console.log("[v0] Setting isMyTurn to true")
        setIsMyTurn(true)
        setTurn((prev) => {
          console.log("[v0] Incrementing turn from", prev, "to", prev + 1)
          return prev + 1
        })
        setPhase("draw")
        console.log("[v0] Changed phase to draw")

        // Enable my units to attack
        setMyField((prev) => ({
          ...prev,
          unitZone: prev.unitZone.map((unit) =>
            unit && turn >= unit.canAttackTurn ? { ...unit, canAttack: true, hasAttacked: false } : unit
          ),
          ultimateZone: prev.ultimateZone && turn >= prev.ultimateZone.canAttackTurn
            ? { ...prev.ultimateZone, canAttack: true, hasAttacked: false }
            : prev.ultimateZone,
        }))
        break

      case "surrender":
        console.log("[v0] Received surrender action from opponent")
        if (!gameResultRecordedRef.current) {
          gameResultRecordedRef.current = true
          setWinReason("surrender")
          setGameResult("won")
          endGame("won")
        }
        break

      case "phase_change":
        // Visual feedback for opponent's phase change
        break
    }

    // Check for game over
    checkGameOver()
  }

  // Check for game over
  const checkGameOver = useCallback(() => {
    if (gameResultRecordedRef.current) return

    if (myField.life <= 0) {
      gameResultRecordedRef.current = true
      setGameResult("lost")
      endGame("lost")
    } else if (opponentField.life <= 0) {
      gameResultRecordedRef.current = true
      setGameResult("won")
      endGame("won")
    }
  }, [myField.life, opponentField.life])

  // End the game
  const endGame = async (result: "won" | "lost") => {
    addMatchRecord({
      id: `online-${Date.now()}`,
      date: new Date().toISOString(),
      opponent: opponentName || "Jogador Online",
      mode: "player",
      result,
      deckUsed: myDeck?.name || "Unknown",
    })

    // Update room status
    await supabase.from("duel_rooms").update({ status: "finished" }).eq("id", roomData.roomId)
  }

  // Check game over on life changes
  useEffect(() => {
    checkGameOver()
  }, [myField.life, opponentField.life, checkGameOver])

  // Global drag event listeners - using refs to avoid stale closures
  const draggedHandCardRef2 = useRef(draggedHandCard)
  const dropTargetRef = useRef(dropTarget)
  const myFieldRef = useRef(myField)
  const isMyTurnRef = useRef(isMyTurn)
  const phaseRef = useRef(phase)
  const turnRef = useRef(turn)
  const sendActionRef = useRef(sendAction)
  const playerIdRef = useRef(playerId)
  
  // Keep refs in sync
  useEffect(() => {
    draggedHandCardRef2.current = draggedHandCard
  }, [draggedHandCard])
  
  useEffect(() => {
    dropTargetRef.current = dropTarget
  }, [dropTarget])
  
  useEffect(() => {
    console.log("[v0] myField changed - hand size:", myField.hand.length, "cards:", myField.hand.map(c => c?.name))
    myFieldRef.current = myField
  }, [myField])
  
  useEffect(() => {
    console.log("[v0] isMyTurn changed to:", isMyTurn)
    isMyTurnRef.current = isMyTurn
  }, [isMyTurn])
  
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])
  
  useEffect(() => {
    turnRef.current = turn
  }, [turn])
  
  useEffect(() => {
    sendActionRef.current = sendAction
  }, [sendAction])
  
  useEffect(() => {
    playerIdRef.current = playerId
  }, [playerId])

  useEffect(() => {
    const handleGlobalMove = (e: MouseEvent | TouchEvent) => {
      const dragged = draggedHandCardRef2.current
      if (!dragged || !draggedCardRef.current) return

      e.preventDefault()

      const clientX = "touches" in e ? e.touches[0].clientX : (e as MouseEvent).clientX
      const clientY = "touches" in e ? e.touches[0].clientY : (e as MouseEvent).clientY

      // Calculate rotation based on horizontal movement
      const deltaX = clientX - dragPosRef.current.x
      const targetRotation = Math.max(-10, Math.min(10, deltaX * 0.8))
      dragPosRef.current.rotation = targetRotation * 0.4 + dragPosRef.current.rotation * 0.6
      dragPosRef.current.x = clientX
      dragPosRef.current.y = clientY

      // Update ghost DOM directly for smooth movement
      const isOverTarget = dropTargetRef.current !== null
      draggedCardRef.current.style.transform = `translate(${clientX - 40}px, ${clientY - 56}px) rotate(${isOverTarget ? 0 : dragPosRef.current.rotation}deg) scale(${isOverTarget ? 1.2 : 1.1})`

      // Throttled drop target check
      const now = Date.now()
      if (!dragPosRef.current.lastCheck || now - dragPosRef.current.lastCheck > 50) {
        dragPosRef.current.lastCheck = now

        const elements = document.elementsFromPoint(clientX, clientY)
        let foundTarget: { type: "unit" | "function" | "scenario" | "ultimate"; index: number } | null = null
        const currentField = myFieldRef.current

        for (const el of elements) {
          const unitSlot = el.closest("[data-player-unit-slot]")
          const funcSlot = el.closest("[data-player-func-slot]")
          const scenarioSlot = el.closest("[data-player-scenario-slot]")
          const ultimateSlot = el.closest("[data-player-ultimate-slot]")

          if (ultimateSlot && isUltimateCard(dragged.card)) {
            if (!currentField.ultimateZone) {
              foundTarget = { type: "ultimate", index: 0 }
              break
            }
          } else if (unitSlot && isUnitCard(dragged.card) && !isUltimateCard(dragged.card)) {
            const slotIndex = Number.parseInt(unitSlot.getAttribute("data-player-unit-slot") || "0")
            if (!currentField.unitZone[slotIndex]) {
              foundTarget = { type: "unit", index: slotIndex }
              break
            }
          } else if (funcSlot && !isUnitCard(dragged.card) && dragged.card.type !== "scenario") {
            const slotIndex = Number.parseInt(funcSlot.getAttribute("data-player-func-slot") || "0")
            if (!currentField.functionZone[slotIndex]) {
              foundTarget = { type: "function", index: slotIndex }
              break
            }
          } else if (scenarioSlot && dragged.card.type === "scenario") {
            if (!currentField.scenarioZone) {
              foundTarget = { type: "scenario", index: 0 }
              break
            }
          }
        }

        if (foundTarget?.type !== dropTargetRef.current?.type || foundTarget?.index !== dropTargetRef.current?.index) {
          setDropTarget(foundTarget)
        }
      }
    }

    const handleGlobalEnd = () => {
      const dragged = draggedHandCardRef2.current
      const target = dropTargetRef.current
      const currentField = myFieldRef.current
      const currentIsMyTurn = isMyTurnRef.current
      const currentPhase = phaseRef.current
      const currentTurn = turnRef.current
      const currentSendAction = sendActionRef.current
      const currentPlayerId = playerIdRef.current
      
      if (!dragged) {
        setDropTarget(null)
        return
      }

      if (target && currentIsMyTurn && currentPhase === "main") {
        const targetSelector =
          target.type === "unit"
            ? `[data-player-unit-slot="${target.index}"]`
            : target.type === "function"
              ? `[data-player-func-slot="${target.index}"]`
              : target.type === "ultimate"
                ? `[data-player-ultimate-slot]`
                : `[data-player-scenario-slot]`
        const targetElement = document.querySelector(targetSelector)
        const targetRect = targetElement?.getBoundingClientRect()

        const cardIndex = dragged.index
        const targetType = target.type
        const targetIndex = target.index
        const cardToPlay = dragged.card

        // Directly update the field state instead of calling functions with stale closures
        if (targetType === "ultimate" && isUltimateCard(cardToPlay) && !currentField.ultimateZone) {
          setMyField((prev) => {
            const newHand = prev.hand.filter((_, i) => i !== cardIndex)
            return {
              ...prev,
              ultimateZone: {
                ...cardToPlay,
                currentDp: cardToPlay.dp,
                canAttack: false,
                hasAttacked: false,
                canAttackTurn: currentTurn,
              },
              hand: newHand,
            }
          })
          currentSendAction({
            type: "place_ultimate",
            playerId: currentPlayerId,
            data: { card: cardToPlay },
            timestamp: Date.now(),
          })
        } else if (targetType === "scenario" && cardToPlay.type === "scenario" && !currentField.scenarioZone) {
          setMyField((prev) => {
            const newHand = prev.hand.filter((_, i) => i !== cardIndex)
            return { ...prev, scenarioZone: cardToPlay, hand: newHand }
          })
          currentSendAction({
            type: "place_card",
            playerId: currentPlayerId,
            data: { zone: "scenario", index: 0, card: cardToPlay },
            timestamp: Date.now(),
          })
        } else if (targetType === "unit" && isUnitCard(cardToPlay) && !isUltimateCard(cardToPlay)) {
          if (!currentField.unitZone[targetIndex]) {
            setMyField((prev) => {
              const newHand = prev.hand.filter((_, i) => i !== cardIndex)
              const newUnitZone = [...prev.unitZone]
              newUnitZone[targetIndex] = {
                ...cardToPlay,
                currentDp: cardToPlay.dp,
                canAttack: false,
                hasAttacked: false,
                canAttackTurn: currentTurn,
              }
              return { ...prev, unitZone: newUnitZone, hand: newHand }
            })
            currentSendAction({
              type: "place_card",
              playerId: currentPlayerId,
              data: { zone: "unit", index: targetIndex, card: cardToPlay },
              timestamp: Date.now(),
            })
          }
        } else if (targetType === "function" && !isUnitCard(cardToPlay) && cardToPlay.type !== "scenario") {
          if (!currentField.functionZone[targetIndex]) {
            setMyField((prev) => {
              const newHand = prev.hand.filter((_, i) => i !== cardIndex)
              const newFunctionZone = [...prev.functionZone]
              newFunctionZone[targetIndex] = cardToPlay
              return { ...prev, functionZone: newFunctionZone, hand: newHand }
            })
            currentSendAction({
              type: "place_card",
              playerId: currentPlayerId,
              data: { zone: "function", index: targetIndex, card: cardToPlay },
              timestamp: Date.now(),
            })
          }
        }
        
        setSelectedHandCard(null)

        // Show materialize animation
        if (targetRect) {
          const targetX = targetRect.left + targetRect.width / 2
          const targetY = targetRect.top + targetRect.height / 2

          setDroppingCard({
            card: cardToPlay,
            targetX,
            targetY,
          })

          setTimeout(() => {
            setDroppingCard(null)
          }, 500)
        }
      }

      // Always clear drag state
      setDraggedHandCard(null)
      setDropTarget(null)
    }

    window.addEventListener("mousemove", handleGlobalMove)
    window.addEventListener("mouseup", handleGlobalEnd)
    window.addEventListener("touchmove", handleGlobalMove, { passive: false })
    window.addEventListener("touchend", handleGlobalEnd)

    return () => {
      window.removeEventListener("mousemove", handleGlobalMove)
      window.removeEventListener("mouseup", handleGlobalEnd)
      window.removeEventListener("touchmove", handleGlobalMove)
      window.removeEventListener("touchend", handleGlobalEnd)
    }
  }, [])

  // Card inspection handlers
  const handleCardPressStart = (card: GameCard) => {
    if (cardPressTimer.current) {
      clearTimeout(cardPressTimer.current)
    }
    cardPressTimer.current = setTimeout(() => {
      setInspectedCard(card)
    }, 300)
  }

  const handleCardPressEnd = () => {
    if (cardPressTimer.current) {
      clearTimeout(cardPressTimer.current)
      cardPressTimer.current = null
    }
  }

  // Can unit attack now?
  const canUnitAttackNow = (card: FieldCard): boolean => {
    return isMyTurn && phase === "battle" && card.canAttack && !card.hasAttacked && turn > card.canAttackTurn
  }

  // Draw a card
  const drawCard = () => {
  if (!isMyTurn || phase !== "draw") return
  
  setMyField((prev) => {
  if (prev.deck.length === 0) return prev
  const drawnCard = prev.deck[0]
  const newDeck = prev.deck.slice(1)
  const newHand = [...prev.hand, drawnCard]
  
  // Show draw animation
  showDrawAnimation(drawnCard)
  
  sendAction({
  type: "draw",
  playerId,
  data: { handSize: newHand.length, deckSize: newDeck.length },
  timestamp: Date.now(),
  })
  
  return { ...prev, deck: newDeck, hand: newHand }
  })
  
  setPhase("main")
  }

  // Advance phase
  const advancePhase = () => {
    if (!isMyTurn) return

    if (phase === "draw") {
      drawCard()
    } else if (phase === "main") {
      setPhase("battle")
      // Enable units to attack that were placed in previous turns
      setMyField((prev) => ({
        ...prev,
        unitZone: prev.unitZone.map((unit) => (unit && turn > unit.canAttackTurn ? { ...unit, canAttack: true } : unit)),
        ultimateZone: prev.ultimateZone && turn > prev.ultimateZone.canAttackTurn
          ? { ...prev.ultimateZone, canAttack: true }
          : prev.ultimateZone,
      }))
      sendAction({
        type: "phase_change",
        playerId,
        data: { phase: "battle" },
        timestamp: Date.now(),
      })
    }
  }

  // Place a card
  const placeCard = (zone: "unit" | "function", index: number, forcedCardIndex?: number) => {
    const cardIndex = forcedCardIndex ?? (draggedHandCard?.index ?? selectedHandCard)
    if (!isMyTurn || phase !== "main" || cardIndex === null) return

    const card = myField.hand[cardIndex]
    if (!card) return

    // Check zone compatibility
    if (zone === "unit" && !isUnitCard(card)) return
    if (zone === "function" && isUnitCard(card)) return
    if (card.type === "scenario") return // Scenario cards go to scenario zone only
    if (isUltimateCard(card)) return // Ultimate cards go to ultimate zone only

    setMyField((prev) => {
      const newHand = prev.hand.filter((_, i) => i !== cardIndex)

      if (zone === "unit") {
        const newUnitZone = [...prev.unitZone]
        if (newUnitZone[index] !== null) return prev // Slot occupied
        newUnitZone[index] = {
          ...card,
          currentDp: card.dp,
          canAttack: false,
          hasAttacked: false,
          canAttackTurn: turn,
        }
        return { ...prev, unitZone: newUnitZone, hand: newHand }
      } else {
        const newFunctionZone = [...prev.functionZone]
        if (newFunctionZone[index] !== null) return prev // Slot occupied
        newFunctionZone[index] = card
        return { ...prev, functionZone: newFunctionZone, hand: newHand }
      }
    })

    // Send action to opponent
    sendAction({
      type: "place_card",
      playerId,
      data: { zone, index, card },
      timestamp: Date.now(),
    })

    setSelectedHandCard(null)
  }

  // Place ultimate card (ultimateGear, ultimateGuardian)
  const placeUltimateCard = (forcedCardIndex?: number) => {
    const cardIndex = forcedCardIndex ?? (draggedHandCard?.index ?? selectedHandCard)
    if (!isMyTurn || phase !== "main" || cardIndex === null) return

    const card = myField.hand[cardIndex]
    if (!card || !isUltimateCard(card)) return
    if (myField.ultimateZone !== null) return

    setMyField((prev) => {
      const newHand = prev.hand.filter((_, i) => i !== cardIndex)
      return {
        ...prev,
        ultimateZone: {
          ...card,
          currentDp: card.dp,
          canAttack: false,
          hasAttacked: false,
          canAttackTurn: turn,
        },
        hand: newHand,
      }
    })

    sendAction({
      type: "place_ultimate",
      playerId,
      data: { card },
      timestamp: Date.now(),
    })

    setSelectedHandCard(null)
  }

  // Place scenario card
  const placeScenarioCard = (forcedCardIndex?: number) => {
    const cardIndex = forcedCardIndex ?? (draggedHandCard?.index ?? selectedHandCard)
    if (!isMyTurn || phase !== "main" || cardIndex === null) return

    const card = myField.hand[cardIndex]
    if (!card || card.type !== "scenario") return
    if (myField.scenarioZone !== null) return // Already has scenario

    setMyField((prev) => {
      const newHand = prev.hand.filter((_, i) => i !== cardIndex)
      return { ...prev, scenarioZone: card, hand: newHand }
    })

    sendAction({
      type: "place_scenario",
      playerId,
      data: { card },
      timestamp: Date.now(),
    })

    setSelectedHandCard(null)
  }

  // Hand card drag handlers
  const handleHandCardDragStart = (index: number, e: React.MouseEvent | React.TouchEvent) => {
    if (!isMyTurn || phase !== "main") return

    const card = myField.hand[index]
    if (!card) return

    e.preventDefault()

    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY

    dragPosRef.current = { x: clientX, y: clientY, rotation: 0, lastCheck: 0 }
    setDraggedHandCard({ index, card, currentY: clientY })
    setSelectedHandCard(index)

    // Update ghost position immediately
    if (draggedCardRef.current) {
      draggedCardRef.current.style.transform = `translate(${clientX - 40}px, ${clientY - 56}px) rotate(0deg) scale(1.1)`
    }
  }

  const handleHandCardDragMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!draggedHandCard || !draggedCardRef.current) return

    e.preventDefault()

    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY

    // Calculate rotation based on horizontal movement
    const deltaX = clientX - dragPosRef.current.x
    const targetRotation = Math.max(-10, Math.min(10, deltaX * 0.8))
    dragPosRef.current.rotation = targetRotation * 0.4 + dragPosRef.current.rotation * 0.6
    dragPosRef.current.x = clientX
    dragPosRef.current.y = clientY

    // Update ghost DOM directly for smooth movement
    const isOverTarget = dropTarget !== null
    draggedCardRef.current.style.transform = `translate(${clientX - 40}px, ${clientY - 56}px) rotate(${isOverTarget ? 0 : dragPosRef.current.rotation}deg) scale(${isOverTarget ? 1.2 : 1.1})`

    // Throttled drop target check
    const now = Date.now()
    if (!dragPosRef.current.lastCheck || now - dragPosRef.current.lastCheck > 50) {
      dragPosRef.current.lastCheck = now

      const elements = document.elementsFromPoint(clientX, clientY)
      let foundTarget: { type: "unit" | "function" | "scenario" | "ultimate"; index: number } | null = null

      for (const el of elements) {
        const unitSlot = el.closest("[data-player-unit-slot]")
        const funcSlot = el.closest("[data-player-func-slot]")
        const scenarioSlot = el.closest("[data-player-scenario-slot]")
        const ultimateSlot = el.closest("[data-player-ultimate-slot]")

        if (ultimateSlot && isUltimateCard(draggedHandCard.card)) {
          if (!myField.ultimateZone) {
            foundTarget = { type: "ultimate", index: 0 }
            break
          }
        } else if (unitSlot && isUnitCard(draggedHandCard.card) && !isUltimateCard(draggedHandCard.card)) {
          const slotIndex = Number.parseInt(unitSlot.getAttribute("data-player-unit-slot") || "0")
          if (!myField.unitZone[slotIndex]) {
            foundTarget = { type: "unit", index: slotIndex }
            break
          }
        } else if (funcSlot && !isUnitCard(draggedHandCard.card) && draggedHandCard.card.type !== "scenario") {
          const slotIndex = Number.parseInt(funcSlot.getAttribute("data-player-func-slot") || "0")
          if (!myField.functionZone[slotIndex]) {
            foundTarget = { type: "function", index: slotIndex }
            break
          }
        } else if (scenarioSlot && draggedHandCard.card.type === "scenario") {
          if (!myField.scenarioZone) {
            foundTarget = { type: "scenario", index: 0 }
            break
          }
        }
      }

      if (foundTarget?.type !== dropTarget?.type || foundTarget?.index !== dropTarget?.index) {
        setDropTarget(foundTarget)
      }
    }
  }

  const handleHandCardDragEnd = () => {
    if (!draggedHandCard) {
      setDropTarget(null)
      return
    }

    if (dropTarget) {
      const targetSelector =
        dropTarget.type === "unit"
          ? `[data-player-unit-slot="${dropTarget.index}"]`
          : dropTarget.type === "function"
            ? `[data-player-func-slot="${dropTarget.index}"]`
            : dropTarget.type === "ultimate"
              ? `[data-player-ultimate-slot]`
              : `[data-player-scenario-slot]`
      const targetElement = document.querySelector(targetSelector)
      const targetRect = targetElement?.getBoundingClientRect()

      const cardIndex = draggedHandCard.index
      const targetType = dropTarget.type
      const targetIndex = dropTarget.index
      const cardToPlay = draggedHandCard.card

      // Place the card
      if (targetType === "ultimate") {
        placeUltimateCard(cardIndex)
      } else if (targetType === "scenario") {
        placeScenarioCard(cardIndex)
      } else {
        placeCard(targetType, targetIndex, cardIndex)
      }
      setSelectedHandCard(null)

      // Show materialize animation
      if (targetRect) {
        const targetX = targetRect.left + targetRect.width / 2
        const targetY = targetRect.top + targetRect.height / 2

        setDroppingCard({
          card: cardToPlay,
          targetX,
          targetY,
        })

        setTimeout(() => {
          setDroppingCard(null)
        }, 500)
      }
    }

    // Always clear drag state
    setDraggedHandCard(null)
    setDropTarget(null)
  }

  // Attack handlers
  const handleAttackStart = (unitIndex: number, e: React.MouseEvent | React.TouchEvent) => {
    if (!isMyTurn || phase !== "battle") return

    const unit = myField.unitZone[unitIndex]
    if (!unit || !canUnitAttackNow(unit)) return

    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY

    positionRef.current = {
      startX: clientX,
      startY: clientY,
      currentX: clientX,
      currentY: clientY,
    }

    setArrowPos({
      x1: clientX,
      y1: clientY,
      x2: clientX,
      y2: clientY,
    })

    setAttackState({
      isAttacking: true,
      attackerIndex: unitIndex,
      targetInfo: null,
    })
  }

  const handleAttackMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!attackState.isAttacking) return

    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY

    positionRef.current.currentX = clientX
    positionRef.current.currentY = clientY

    setArrowPos((prev) => ({
      ...prev,
      x2: clientX,
      y2: clientY,
    }))

    // Check for targets
    const elements = document.elementsFromPoint(clientX, clientY)
    let newTarget: { type: "direct" | "unit"; index?: number } | null = null

    for (const el of elements) {
      const enemyUnit = el.closest("[data-enemy-unit]")
      if (enemyUnit) {
        const index = Number.parseInt(enemyUnit.getAttribute("data-enemy-unit") || "-1", 10)
        if (index >= 0 && opponentField.unitZone[index]) {
          newTarget = { type: "unit", index }
          break
        }
      }

      if (el.closest("[data-direct-attack]")) {
        newTarget = { type: "direct" }
        break
      }
    }

    setAttackTarget(newTarget)
  }

  const handleAttackEnd = () => {
    if (!attackState.isAttacking || attackState.attackerIndex === null) {
      setAttackState({ isAttacking: false, attackerIndex: null, targetInfo: null })
      setAttackTarget(null)
      return
    }

    if (attackTarget) {
      performAttack(attackTarget.type, attackTarget.index)
    }

    setAttackState({ isAttacking: false, attackerIndex: null, targetInfo: null })
    setAttackTarget(null)
  }

  // Perform attack
  const performAttack = (targetType: "direct" | "unit", targetIndex?: number) => {
    if (!isMyTurn || phase !== "battle" || attackState.attackerIndex === null) return

    const attacker = myField.unitZone[attackState.attackerIndex]
    if (!attacker || !attacker.canAttack || attacker.hasAttacked) return

    const damage = attacker.currentDp
    const attackerIdx = attackState.attackerIndex

    if (targetType === "direct") {
      // Direct attack
      setOpponentField((prev) => ({
        ...prev,
        life: Math.max(0, prev.life - damage),
      }))

      sendAction({
        type: "attack",
        playerId,
        data: { attackerIndex: attackerIdx, targetType: "direct", damage },
        timestamp: Date.now(),
      })

      // Mark attacker as having attacked
      setMyField((prev) => {
        const newUnitZone = [...prev.unitZone]
        const unit = newUnitZone[attackerIdx]
        if (unit) {
          unit.hasAttacked = true
          unit.canAttack = false
        }
        return { ...prev, unitZone: newUnitZone }
      })
    } else if (targetType === "unit" && targetIndex !== undefined) {
      // Attack a unit
      const target = opponentField.unitZone[targetIndex]
      if (!target) return

      const targetDp = target.currentDp

      // Apply damage to opponent's unit
      setOpponentField((prev) => {
        const newUnitZone = [...prev.unitZone]
        const newGraveyard = [...prev.graveyard]
        const targetUnit = newUnitZone[targetIndex]
        if (targetUnit) {
          targetUnit.currentDp -= damage
          if (targetUnit.currentDp <= 0) {
            newGraveyard.push(targetUnit)
            newUnitZone[targetIndex] = null
          }
        }
        return { ...prev, unitZone: newUnitZone, graveyard: newGraveyard }
      })

      // Attacker takes counter damage
      setMyField((prev) => {
        const newUnitZone = [...prev.unitZone]
        const newGraveyard = [...prev.graveyard]
        const attackerUnit = newUnitZone[attackerIdx]
        if (attackerUnit) {
          attackerUnit.currentDp -= targetDp
          attackerUnit.hasAttacked = true
          attackerUnit.canAttack = false
          if (attackerUnit.currentDp <= 0) {
            newGraveyard.push(attackerUnit)
            newUnitZone[attackerIdx] = null
          }
        }
        return { ...prev, unitZone: newUnitZone, graveyard: newGraveyard }
      })

      sendAction({
        type: "attack",
        playerId,
        data: { attackerIndex: attackerIdx, targetType: "unit", targetIndex, damage, counterDamage: targetDp },
        timestamp: Date.now(),
      })
    }

    checkGameOver()
  }

  // End turn
  const endTurn = () => {
    console.log("[v0] endTurn called, isMyTurn:", isMyTurn)
    if (!isMyTurn) {
      console.log("[v0] Cannot end turn - not my turn")
      return
    }

    console.log("[v0] Ending my turn, setting isMyTurn to false")
    setIsMyTurn(false)
    setPhase("end")
    setSelectedHandCard(null)

    // Disable my units
    setMyField((prev) => ({
      ...prev,
      unitZone: prev.unitZone.map((unit) => (unit ? { ...unit, canAttack: false, hasAttacked: false } : null)),
      ultimateZone: prev.ultimateZone ? { ...prev.ultimateZone, canAttack: false, hasAttacked: false } : null,
    }))

    // Enable opponent's units
    setOpponentField((prev) => ({
      ...prev,
      unitZone: prev.unitZone.map((unit) => (unit ? { ...unit, canAttack: true, hasAttacked: false } : null)),
      ultimateZone: prev.ultimateZone ? { ...prev.ultimateZone, canAttack: true, hasAttacked: false } : null,
    }))

    console.log("[v0] Sending end_turn action to opponent, turn:", turn)
    sendAction({
      type: "end_turn",
      playerId,
      data: { turn },
      timestamp: Date.now(),
    })
  }

  // Surrender
  const surrender = () => {
    if (gameResultRecordedRef.current) return
    gameResultRecordedRef.current = true
    
    // Send surrender action to opponent
    sendAction({
      type: "surrender",
      playerId,
      data: { playerName: roomData.isHost ? roomData.hostName : roomData.guestName },
      timestamp: Date.now(),
    })
    
    setGameResult("lost")
    endGame("lost")
  }

  // Send chat message
  const sendChatMessage = async () => {
    if (!chatInput.trim()) return

    await supabase.from("duel_chat").insert({
      room_id: roomData.roomId,
      sender_id: playerId,
      sender_name: playerProfile.name,
      message: chatInput.trim(),
    })

    setChatInput("")
  }

  // Scroll chat to bottom
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight
    }
  }, [chatMessages])

  // Get playmat for both decks
  const myPlaymat = myDeck ? getPlaymatForDeck(myDeck) : null
  const opponentPlaymat = opponentDeck ? getPlaymatForDeck(opponentDeck) : null

  // Debug logs for playmats
  console.log("[v0] My Deck:", myDeck?.name)
  console.log("[v0] My Playmat:", myPlaymat?.name, myPlaymat?.image)
  console.log("[v0] Opponent Deck:", opponentDeck?.name)
  console.log("[v0] Opponent Playmat:", opponentPlaymat?.name, opponentPlaymat?.image)

  // Game result screen
  if (gameResult) {
    const getResultMessage = () => {
      if (gameResult === "won") {
        if (winReason === "surrender") {
          return `${opponentName} desistiu do duelo!`
        }
        return `Voce derrotou ${opponentName}!`
      }
      return `Voce desistiu do duelo.`
    }

    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-black/90">
        <div className="absolute inset-0 overflow-hidden">
          {gameResult === "won" && (
            <>
              {[...Array(20)].map((_, i) => (
                <div
                  key={i}
                  className="absolute animate-pulse"
                  style={{
                    left: `${Math.random() * 100}%`,
                    top: `${Math.random() * 100}%`,
                    width: `${Math.random() * 4 + 2}px`,
                    height: `${Math.random() * 4 + 2}px`,
                    backgroundColor: "#fbbf24",
                    borderRadius: "50%",
                    animationDelay: `${Math.random() * 2}s`,
                  }}
                />
              ))}
            </>
          )}
        </div>
        <div className="relative z-10 flex flex-col items-center">
          <h1
            className={`text-6xl font-bold mb-4 ${gameResult === "won" ? "text-green-400" : "text-red-400"}`}
            style={{
              textShadow: gameResult === "won" 
                ? "0 0 20px rgba(74, 222, 128, 0.5)" 
                : "0 0 20px rgba(248, 113, 113, 0.5)",
            }}
          >
            {gameResult === "won" ? t("victory") : t("defeat")}
          </h1>
          {winReason === "surrender" && gameResult === "won" && (
            <p className="text-amber-400 text-lg mb-2 font-bold">Vitoria por desistencia!</p>
          )}
          <p className="text-slate-300 text-xl mb-8">{getResultMessage()}</p>
          <Button onClick={onBack} className="px-8 py-4 text-xl bg-gradient-to-r from-slate-700 to-slate-600 hover:from-slate-600 hover:to-slate-500">
            {t("back")}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={fieldRef}
      className="relative h-screen flex flex-col overflow-hidden select-none touch-none"
      style={{
        background: "linear-gradient(135deg, #0a0a1a 0%, #1a1a3a 25%, #0f0f2f 50%, #1a1a3a 75%, #0a0a1a 100%)",
      }}
      onMouseMove={(e) => {
        handleAttackMove(e)
      }}
      onMouseUp={() => {
        handleAttackEnd()
      }}
      onMouseLeave={() => {
        handleAttackEnd()
      }}
      onTouchMove={(e) => {
        handleAttackMove(e)
      }}
      onTouchEnd={() => {
        handleAttackEnd()
      }}
    >
      {/* Background pattern */}
      <div
        className="absolute inset-0 opacity-10 pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(circle at 20% 30%, rgba(59, 130, 246, 0.3) 0%, transparent 50%),
                            radial-gradient(circle at 80% 70%, rgba(147, 51, 234, 0.3) 0%, transparent 50%),
                            radial-gradient(circle at 50% 50%, rgba(6, 182, 212, 0.2) 0%, transparent 60%)`,
        }}
      />

      {/* Animated grid lines */}
      <div
        className="absolute inset-0 opacity-5 pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
          backgroundSize: "50px 50px",
        }}
      />

      {/* Attack Arrow */}
      {attackState.isAttacking && (
        <svg className="fixed inset-0 pointer-events-none z-50" style={{ width: "100vw", height: "100vh" }}>
          <defs>
            <linearGradient id="arrowGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#dc2626" />
              <stop offset="50%" stopColor="#ef4444" />
              <stop offset="100%" stopColor="#f87171" />
            </linearGradient>
            <marker id="arrowhead" markerWidth="12" markerHeight="10" refX="11" refY="5" orient="auto">
              <path d="M 0 0 L 12 5 L 0 10 L 3 5 Z" fill="#f87171" stroke="#dc2626" strokeWidth="0.5" />
            </marker>
          </defs>

          {/* Outer glow */}
          <line
            x1={arrowPos.x1}
            y1={arrowPos.y1}
            x2={arrowPos.x2}
            y2={arrowPos.y2}
            stroke="#f87171"
            strokeWidth="8"
            opacity="0.18"
            strokeLinecap="round"
          />

          {/* Main arrow */}
          <line
            x1={arrowPos.x1}
            y1={arrowPos.y1}
            x2={arrowPos.x2}
            y2={arrowPos.y2}
            stroke="url(#arrowGradient)"
            strokeWidth="4"
            markerEnd="url(#arrowhead)"
            strokeLinecap="round"
          />
        </svg>
      )}

      {/* Top HUD - Enemy info */}
      <div className="relative z-20 flex items-center justify-between px-4 py-2 bg-gradient-to-b from-black/80 to-transparent">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-red-600 to-red-800 border-2 border-red-400 flex items-center justify-center">
            <Swords className="w-6 h-6 text-white" />
          </div>
          <div>
            <span className="text-xs text-slate-400">{opponentName}</span>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-red-400">LP: {opponentField.life}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-center px-4 py-1 bg-black/50 rounded-lg border border-amber-500/30">
            <span className="text-xs text-slate-400">{t("turn")}</span>
            <span className="block text-2xl font-bold text-amber-400">{turn}</span>
          </div>
          <div
            className={`px-4 py-2 rounded-lg text-sm font-bold border-2 ${
              isMyTurn
                ? "bg-green-600/20 border-green-500 text-green-400"
                : "bg-red-600/20 border-red-500 text-red-400"
            }`}
          >
            {isMyTurn ? t("yourTurn") : t("enemyTurn")}
          </div>
        </div>

        <Button onClick={surrender} size="sm" variant="ghost" className="text-slate-400 hover:text-red-400">
          <ArrowLeft className="w-4 h-4 mr-1" />
          {t("surrender")}
        </Button>
      </div>

      {/* Enemy hand (card backs) */}
      <div className="relative z-10 flex justify-center py-1">
        <div className="flex gap-1">
          {opponentField.hand.map((_, i) => (
            <div
              key={i}
              className="w-6 h-8 bg-gradient-to-br from-slate-700 via-slate-600 to-slate-800 rounded border border-slate-500/50 shadow-md"
              style={{
                transform: `rotate(${(i - opponentField.hand.length / 2) * 3}deg) translateY(${Math.abs(i - opponentField.hand.length / 2) * 2}px)`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Main Battle Area with Playmat */}
      <div className="flex-1 flex items-center justify-center px-2 py-1">
        <div
          className="relative w-full max-w-xl mx-auto rounded-xl overflow-hidden"
          style={{
            aspectRatio: "9/16",
            maxHeight: "calc(100vh - 220px)",
            boxShadow: "0 0 30px rgba(0,0,0,0.8), inset 0 0 60px rgba(0,0,0,0.3)",
          }}
        >
          {/* Playmat container with border */}
          <div className="absolute inset-0 rounded-xl border-4 border-amber-600/30 bg-gradient-to-b from-slate-900/90 to-slate-800/90">
            {/* Opponent Playmat Background */}
            {opponentPlaymat ? (
              <div className="absolute inset-x-0 top-0 h-1/2 overflow-hidden">
                <img
                  src={opponentPlaymat.image || "/placeholder.svg"}
                  alt={opponentPlaymat.name}
                  className="w-full h-full object-cover rotate-180"
                  style={{ opacity: 0.6 }}
                />
                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-slate-900/60" />
              </div>
            ) : (
              <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-red-950/30 to-transparent" />
            )}

            {/* Player Playmat Background */}
            {myPlaymat ? (
              <div className="absolute inset-x-0 bottom-0 h-1/2 overflow-hidden">
                <img
                  src={myPlaymat.image || "/placeholder.svg"}
                  alt={myPlaymat.name}
                  className="w-full h-full object-cover"
                  style={{ opacity: 0.6 }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-transparent via-transparent to-slate-900/60" />
              </div>
            ) : (
              <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-blue-950/30 to-transparent" />
            )}
          </div>

          {/* Field content */}
          <div className="relative h-full flex flex-col justify-between p-1.5 pb-3 z-10">
            {/* Enemy Field */}
            <div className="flex justify-center items-center gap-3">
              {/* Enemy Deck, Graveyard, Scenario and Ultimate */}
              <div className="flex items-start gap-1">
                <div className="flex flex-col gap-1">
                  <div
                    className="w-14 h-20 bg-purple-900/80 rounded text-sm text-purple-300 flex items-center justify-center border border-purple-500/50 cursor-pointer hover:bg-purple-800/80 transition-colors"
                    onClick={() => setGraveyardView("enemy")}
                  >
                    {opponentField.graveyard.length}
                  </div>
                  <div className="w-14 h-20 bg-red-700/80 rounded text-sm text-white flex items-center justify-center font-bold border border-red-500/50">
                    {opponentField.deck.length}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  {/* Enemy Scenario Zone - Horizontal slot, aligned with unit zone */}
                  <div className="h-14 w-20 bg-amber-900/40 border border-amber-600/40 rounded flex items-center justify-center relative overflow-hidden">
                    {opponentField.scenarioZone ? (
                      <Image
                        src={opponentField.scenarioZone.image || "/placeholder.svg"}
                        alt={opponentField.scenarioZone.name}
                        fill
                        className="object-cover rounded"
                        onMouseDown={() => handleCardPressStart(opponentField.scenarioZone!)}
                        onMouseUp={handleCardPressEnd}
                        onMouseLeave={handleCardPressEnd}
                        onTouchStart={() => handleCardPressStart(opponentField.scenarioZone!)}
                        onTouchEnd={handleCardPressEnd}
                      />
                    ) : (
                      <span className="text-amber-500/50 text-[8px] text-center">SCENARIO</span>
                    )}
                  </div>
                  {/* Enemy Ultimate Zone - single green slot below scenario */}
                  <div className="w-14 h-20 bg-emerald-900/40 border border-emerald-600/40 rounded flex items-center justify-center relative overflow-hidden mx-auto">
                    {opponentField.ultimateZone ? (
                      <>
                        <Image
                          src={opponentField.ultimateZone.image || "/placeholder.svg"}
                          alt={opponentField.ultimateZone.name}
                          fill
                          className="object-cover rounded"
                          onMouseDown={() => handleCardPressStart(opponentField.ultimateZone!)}
                          onMouseUp={handleCardPressEnd}
                          onMouseLeave={handleCardPressEnd}
                          onTouchStart={() => handleCardPressStart(opponentField.ultimateZone!)}
                          onTouchEnd={handleCardPressEnd}
                        />
                        <div className="absolute bottom-0 left-0 right-0 bg-black/80 text-center text-xs text-white font-bold py-0.5">
                          {opponentField.ultimateZone.currentDp} DP
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Enemy Zones */}
              <div className="flex flex-col gap-1.5">
                {/* Enemy Function Zone */}
                <div className="flex justify-center items-center gap-1.5">
                  {opponentField.functionZone.map((card, i) => (
                    <div
                      key={i}
                      className="w-14 h-20 bg-purple-900/40 border border-purple-600/40 rounded flex items-center justify-center relative overflow-hidden"
                    >
                      {card && (
                        <Image
                          src={card.image || "/placeholder.svg"}
                          alt={card.name}
                          fill
                          className="object-cover rounded"
                          onMouseDown={() => handleCardPressStart(card)}
                          onMouseUp={handleCardPressEnd}
                          onMouseLeave={handleCardPressEnd}
                          onTouchStart={() => handleCardPressStart(card)}
                          onTouchEnd={handleCardPressEnd}
                        />
                      )}
                    </div>
                  ))}
                </div>

                {/* Enemy Unit Zone */}
                <div className="flex justify-center items-center gap-1.5">
                  {opponentField.unitZone.map((card, i) => (
                    <div
                      key={i}
                      data-enemy-unit={i}
                      className={`w-14 h-20 bg-red-900/30 border-2 rounded relative overflow-hidden transition-all ${
                        attackTarget?.type === "unit" && attackTarget.index === i
                          ? "border-red-500 ring-2 ring-red-400 scale-105"
                          : "border-red-700/40"
                      }`}
                    >
                      {card && (
                        <>
                          <Image
                            src={card.image || "/placeholder.svg"}
                            alt={card.name}
                            fill
                            className="object-cover"
                            onMouseDown={() => handleCardPressStart(card)}
                            onMouseUp={handleCardPressEnd}
                            onMouseLeave={handleCardPressEnd}
                            onTouchStart={() => handleCardPressStart(card)}
                            onTouchEnd={handleCardPressEnd}
                          />
                          <div className="absolute bottom-0 left-0 right-0 bg-black/80 text-center text-xs text-white font-bold py-0.5">
                            {(card as FieldCard).currentDp} DP
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Center Phase indicator and Direct Attack Zone */}
            <div className="flex flex-col items-center gap-1 py-1">
              <div
                data-direct-attack
                className={`px-6 py-1 rounded-full border-2 border-dashed transition-all text-sm font-bold ${
                  attackTarget?.type === "direct"
                    ? "border-red-500 bg-red-500/30 text-red-300 scale-105"
                    : "border-slate-500/50 text-slate-500"
                }`}
              >
                {attackTarget?.type === "direct" ? "ATAQUE DIRETO!" : ""}
              </div>

              {/* Phase divider */}
              <div className="w-full flex items-center gap-2">
                <div className="flex-1 h-0.5 bg-gradient-to-r from-transparent via-amber-500/60 to-amber-500" />
                <span className="text-amber-400 text-xs font-bold px-3 py-1 bg-black/60 rounded-full border border-amber-500/40">
                  {phase === "draw" ? "DRAW" : phase === "main" ? "MAIN" : phase === "battle" ? "BATTLE" : "END"}
                </span>
                <div className="flex-1 h-0.5 bg-gradient-to-l from-transparent via-amber-500/60 to-amber-500" />
              </div>
            </div>

            {/* Player Field */}
            <div className="flex justify-center items-center gap-3">
              {/* Player Zones */}
              <div className="flex flex-col gap-1.5">
                {/* Player Unit Zone */}
                <div className="flex justify-center items-center gap-1.5">
                  {myField.unitZone.map((card, i) => {
                    const canAttack = card && canUnitAttackNow(card as FieldCard)
                    const isSelectedTarget =
                      selectedHandCard !== null && isUnitCard(myField.hand[selectedHandCard]) && !card
                    const isDragTarget =
                      draggedHandCard && isUnitCard(draggedHandCard.card) && !card
                    const isDropping = dropTarget?.type === "unit" && dropTarget?.index === i
                    const isValidDropTarget = isSelectedTarget || isDragTarget

                    return (
                      <div
                        key={i}
                        data-player-unit-slot={i}
                        onClick={() => {
                          if (selectedHandCard !== null && !card && !draggedHandCard) {
                            placeCard("unit", i)
                          }
                        }}
                        className={`w-14 h-20 bg-blue-900/30 border-2 rounded relative overflow-hidden transition-all duration-200 ${
                          isDropping
                            ? "border-green-400 bg-green-500/50 scale-110 shadow-lg shadow-green-500/50"
                            : isValidDropTarget
                              ? "border-green-500 bg-green-900/40 cursor-pointer"
                              : canAttack
                                ? "border-yellow-400 shadow-lg shadow-yellow-500/40"
                                : "border-blue-700/40"
                        }`}
                      >
                        {canAttack && (
                          <div className="absolute -inset-1 bg-yellow-400/40 rounded blur-sm animate-pulse -z-10" />
                        )}
                        {card && (
                          <>
                            <Image
                              src={card.image || "/placeholder.svg"}
                              alt={card.name}
                              fill
                              className="object-cover"
                              onMouseDown={(e) => {
                                if (canAttack) {
                                  handleAttackStart(i, e)
                                } else {
                                  handleCardPressStart(card)
                                }
                              }}
                              onMouseUp={handleCardPressEnd}
                              onMouseLeave={handleCardPressEnd}
                              onTouchStart={(e) => {
                                if (canAttack) {
                                  handleAttackStart(i, e)
                                } else {
                                  handleCardPressStart(card)
                                }
                              }}
                              onTouchEnd={handleCardPressEnd}
                            />
                            {canAttack && (
                              <div className="absolute top-0 left-0 right-0 bg-green-500 text-white text-[10px] text-center font-bold animate-pulse">
                                {t("dragToAttack")}
                              </div>
                            )}
                            {!canAttack && card && turn <= (card as FieldCard).canAttackTurn && (
                              <div className="absolute top-0 left-0 right-0 bg-amber-600/90 text-white text-[8px] text-center">
                                T{(card as FieldCard).canAttackTurn + 1}
                              </div>
                            )}
                            <div className="absolute bottom-0 left-0 right-0 bg-black/80 text-center text-xs text-white font-bold py-0.5">
                              {card.currentDp} DP
                            </div>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Player Function Zone */}
                <div className="flex justify-center items-center gap-1.5">
                  {myField.functionZone.map((card, i) => {
                    const isSelectedTarget =
                      selectedHandCard !== null &&
                      !isUnitCard(myField.hand[selectedHandCard]) &&
                      myField.hand[selectedHandCard]?.type !== "scenario" &&
                      !card
                    const isDragTarget =
                      draggedHandCard &&
                      !isUnitCard(draggedHandCard.card) &&
                      draggedHandCard.card.type !== "scenario" &&
                      !card
                    const isDropping = dropTarget?.type === "function" && dropTarget?.index === i
                    const isValidDropTarget = isSelectedTarget || isDragTarget

                    return (
                      <div
                        key={i}
                        data-player-func-slot={i}
                        onClick={() => {
                          if (selectedHandCard !== null && !card && !draggedHandCard) {
                            placeCard("function", i)
                          }
                        }}
                        className={`w-14 h-20 bg-purple-900/30 border-2 rounded flex items-center justify-center cursor-pointer transition-all duration-200 relative overflow-hidden ${
                          isDropping
                            ? "border-green-400 bg-green-500/50 scale-110 shadow-lg shadow-green-500/50"
                            : isValidDropTarget
                              ? "border-green-500 bg-green-900/40"
                              : "border-purple-600/40"
                        }`}
                      >
                        {card && (
                          <Image
                            src={card.image || "/placeholder.svg"}
                            alt={card.name}
                            fill
                            className="object-cover rounded"
                            onMouseDown={() => handleCardPressStart(card)}
                            onMouseUp={handleCardPressEnd}
                            onMouseLeave={handleCardPressEnd}
                            onTouchStart={() => handleCardPressStart(card)}
                            onTouchEnd={handleCardPressEnd}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Player Scenario, Ultimate Zone and Deck/Graveyard */}
              <div className="flex items-start gap-1">
                <div className="flex flex-col gap-1">
                  {/* Player Scenario Zone - Horizontal slot, aligned with unit zone */}
                  {(() => {
                    const isSelectedTarget =
                      selectedHandCard !== null &&
                      myField.hand[selectedHandCard]?.type === "scenario" &&
                      !myField.scenarioZone
                    const isDragTarget =
                      draggedHandCard && draggedHandCard.card.type === "scenario" && !myField.scenarioZone
                    const isDropping = dropTarget?.type === "scenario"
                    const isValidDropTarget = isSelectedTarget || isDragTarget

                    return (
                      <div
                        data-player-scenario-slot
                        onClick={() => {
                          if (selectedHandCard !== null && myField.hand[selectedHandCard]?.type === "scenario" && !draggedHandCard) {
                            placeScenarioCard()
                          }
                        }}
                        className={`h-14 w-20 bg-amber-900/30 border-2 rounded flex items-center justify-center relative overflow-hidden transition-all duration-200 ${
                          isDropping
                            ? "border-green-400 bg-green-500/50 scale-110 shadow-lg shadow-green-500/50"
                            : isValidDropTarget
                              ? "border-green-500 bg-green-900/40 cursor-pointer"
                              : "border-amber-600/40"
                        }`}
                      >
                        {myField.scenarioZone ? (
                          <Image
                            src={myField.scenarioZone.image || "/placeholder.svg"}
                            alt={myField.scenarioZone.name}
                            fill
                            className="object-cover rounded"
                            onMouseDown={() => handleCardPressStart(myField.scenarioZone!)}
                            onMouseUp={handleCardPressEnd}
                            onMouseLeave={handleCardPressEnd}
                            onTouchStart={() => handleCardPressStart(myField.scenarioZone!)}
                            onTouchEnd={handleCardPressEnd}
                          />
                        ) : (
                          <span className="text-amber-500/50 text-[8px] text-center">SCENARIO</span>
                        )}
                      </div>
                    )
                  })()}
                  {/* Player Ultimate Zone - single green slot below scenario */}
                  {(() => {
                    const isSelectedUltimate =
                      selectedHandCard !== null &&
                      myField.hand[selectedHandCard] &&
                      isUltimateCard(myField.hand[selectedHandCard]) &&
                      !myField.ultimateZone
                    const isDragUltimate =
                      draggedHandCard && isUltimateCard(draggedHandCard.card) && !myField.ultimateZone
                    const isDroppingUltimate = dropTarget?.type === "ultimate"
                    const isValidUltimateTarget = isSelectedUltimate || isDragUltimate

                    return (
                      <div
                        data-player-ultimate-slot
                        onClick={() => {
                          if (selectedHandCard !== null && myField.hand[selectedHandCard] && isUltimateCard(myField.hand[selectedHandCard]) && !draggedHandCard) {
                            placeUltimateCard()
                          }
                        }}
                        className={`w-14 h-20 bg-emerald-900/30 border-2 rounded flex items-center justify-center relative overflow-hidden transition-all duration-200 mx-auto ${
                          isDroppingUltimate
                            ? "border-green-400 bg-green-500/60 scale-110 shadow-lg shadow-green-500/50 ring-2 ring-green-400/50 animate-pulse"
                            : isValidUltimateTarget
                              ? "border-emerald-400 bg-emerald-900/40 cursor-pointer"
                              : "border-emerald-600/40"
                        }`}
                      >
                        {myField.ultimateZone ? (
                          <>
                            <Image
                              src={myField.ultimateZone.image || "/placeholder.svg"}
                              alt={myField.ultimateZone.name}
                              fill
                              className="object-cover rounded"
                              onMouseDown={() => handleCardPressStart(myField.ultimateZone!)}
                              onMouseUp={handleCardPressEnd}
                              onMouseLeave={handleCardPressEnd}
                              onTouchStart={() => handleCardPressStart(myField.ultimateZone!)}
                              onTouchEnd={handleCardPressEnd}
                            />
                            <div className="absolute bottom-0 left-0 right-0 bg-black/80 text-center text-xs text-white font-bold py-0.5">
                              {myField.ultimateZone.currentDp} DP
                            </div>
                          </>
                        ) : null}
                        {!myField.ultimateZone && isDroppingUltimate && (
                          <span className="text-green-400 text-[10px] font-bold animate-pulse">SOLTAR</span>
                        )}
                      </div>
                    )
                  })()}
                </div>
                <div className="flex flex-col gap-1">
                  <div className="w-14 h-20 bg-blue-700/80 rounded text-sm text-white flex items-center justify-center font-bold border border-blue-500/50">
                    {myField.deck.length}
                  </div>
                  <div
                    className="w-14 h-20 bg-purple-900/80 rounded text-sm text-purple-300 flex items-center justify-center border border-purple-500/50 cursor-pointer hover:bg-purple-800/80 transition-colors"
                    onClick={() => setGraveyardView("player")}
                  >
                    {myField.graveyard.length}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom HUD - Player info and controls */}
      <div className="relative z-20 bg-gradient-to-t from-black/95 via-black/90 to-transparent pt-2 pb-2 px-4">
        {/* Player LP bar */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-600 to-blue-800 border-2 border-blue-400 flex items-center justify-center shadow-lg shadow-blue-500/30">
              <span className="text-white font-bold">P1</span>
            </div>
            <div>
              <span className="text-xs text-slate-400">{playerProfile.name}</span>
              <div className="text-xl font-bold text-blue-400">LP: {myField.life}</div>
            </div>
          </div>

          {/* Empty space for balance */}
          <div className="flex gap-2 min-h-[40px]">
          </div>

          {/* Chat toggle */}
          <Button variant="ghost" onClick={() => setShowChat(!showChat)} className="text-white p-2">
            <MessageCircle className="w-5 h-5" />
          </Button>
        </div>

        {/* Player Hand with Phase Buttons on the right side */}
        <div className="flex justify-center items-end -mt-14 min-h-28">
          {/* Phase Buttons - positioned on the right edge */}
          <div className="absolute right-4 bottom-4 z-30">
            {isMyTurn && phase === "draw" && (
              <Button
                onClick={advancePhase}
                size="lg"
                className="bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white font-bold px-8 py-6 shadow-lg shadow-green-500/30 animate-pulse"
              >
                {t("drawCard")}
              </Button>
            )}
            {isMyTurn && phase === "main" && (
              <Button
                onClick={advancePhase}
                size="lg"
                className="bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-bold px-8 py-6 shadow-lg shadow-blue-500/30 animate-pulse"
              >
                {t("toBattle")}
              </Button>
            )}
            {isMyTurn && phase === "battle" && (
              <Button
                onClick={endTurn}
                size="lg"
                className="bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white font-bold px-8 py-6 shadow-lg shadow-amber-500/30 animate-pulse"
              >
                {t("endTurn")}
              </Button>
            )}
          </div>
          <div className="flex gap-3 items-end">
            {myField.hand.map((card, i) => {
              const offset = i - (myField.hand.length - 1) / 2
              const rotation = offset * 4
              const translateY = Math.abs(offset) * 5
              const isSelected = selectedHandCard === i
              const isDragging = draggedHandCard?.index === i

              // Check if card can be played
              const hasSpaceInZone = isUltimateCard(card)
                ? myField.ultimateZone === null
                : card.type === "scenario"
                  ? myField.scenarioZone === null
                  : isUnitCard(card)
                    ? myField.unitZone.some((slot) => slot === null)
                    : myField.functionZone.some((slot) => slot === null)
              const canPlay = isMyTurn && phase === "main" && hasSpaceInZone

              return (
                <div
                  key={i}
                  className="relative"
                  onClick={() => {
                    if (canPlay && !draggedHandCard) {
                      setSelectedHandCard(isSelected ? null : i)
                    }
                  }}
                  onMouseDown={(e) => canPlay && handleHandCardDragStart(i, e)}
                  onTouchStart={(e) => canPlay && handleHandCardDragStart(i, e)}
                >
                  <div
                    className={`relative w-20 h-28 rounded-xl border-2 overflow-hidden transition-all duration-200 cursor-pointer ${
                      isDragging
                        ? "opacity-30 scale-95"
                        : isSelected
                          ? "border-amber-400 ring-2 ring-amber-400/60 -translate-y-6 scale-110 z-30"
                          : canPlay
                            ? "border-amber-500/50 hover:-translate-y-4 hover:border-amber-400"
                            : "border-slate-600/50 opacity-60"
                    }`}
                    style={{
                      transform: isDragging
                        ? "scale(0.95)"
                        : isSelected
                          ? "translateY(-24px) scale(1.1)"
                          : `rotate(${rotation}deg) translateY(${translateY}px)`,
                      zIndex: isSelected ? 30 : 10 + i,
                    }}
                  >
                    <div className="relative w-full h-full overflow-hidden rounded-lg">
                      <Image
                        src={card.image || "/placeholder.svg"}
                        alt={card.name}
                        fill
                        className="object-cover"
                      />
                    </div>
                  </div>
                  {/* Drag hint */}
                  {canPlay && isSelected && !isDragging && (
                    <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-yellow-400 text-[10px] font-bold whitespace-nowrap">
                      Arraste para jogar
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Chat overlay */}
      {showChat && (
        <div className="absolute bottom-32 right-4 w-72 bg-slate-900/95 rounded-xl border border-slate-700 shadow-xl z-50">
          <div className="p-3 border-b border-slate-700 flex items-center justify-between">
            <h3 className="text-white font-medium flex items-center gap-2">
              <MessageCircle className="w-4 h-4" />
              Chat
            </h3>
            <button onClick={() => setShowChat(false)} className="text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div ref={chatContainerRef} className="h-40 overflow-y-auto p-3 space-y-2">
            {chatMessages.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-4">Nenhuma mensagem...</p>
            ) : (
              chatMessages.map((msg) => (
                <div key={msg.id} className={`flex flex-col ${msg.sender_id === playerId ? "items-end" : "items-start"}`}>
                  <span className="text-xs text-slate-500 mb-1">{msg.sender_name}</span>
                  <div
                    className={`max-w-[80%] px-3 py-2 rounded-lg ${
                      msg.sender_id === playerId ? "bg-amber-500/30 text-amber-100" : "bg-slate-700 text-slate-200"
                    }`}
                  >
                    <p className="text-sm break-words">{msg.message}</p>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="p-3 border-t border-slate-700">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                sendChatMessage()
              }}
              className="flex gap-2"
            >
              <Input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Mensagem..."
                className="flex-1 bg-slate-700 border-slate-600 text-white text-sm"
                maxLength={100}
              />
              <Button type="submit" disabled={!chatInput.trim()} className="bg-amber-500 hover:bg-amber-600 text-white">
                <Send className="w-4 h-4" />
              </Button>
            </form>
          </div>
        </div>
      )}

      {/* Graveyard View */}
      {graveyardView && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90" onClick={() => setGraveyardView(null)}>
          <div className="bg-slate-900 rounded-xl border border-slate-700 p-4 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-bold text-lg">
                {graveyardView === "player" ? "Seu Cemiterio" : "Cemiterio do Oponente"}
              </h3>
              <button onClick={() => setGraveyardView(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2 max-h-96 overflow-y-auto">
              {(graveyardView === "player" ? myField.graveyard : opponentField.graveyard).map((card, i) => (
                <div
                  key={i}
                  className="relative w-full aspect-[3/4] rounded border border-slate-600 overflow-hidden cursor-pointer hover:border-amber-400 transition-colors"
                  onClick={() => setInspectedCard(card)}
                >
                  <Image src={card.image || "/placeholder.svg"} alt={card.name} fill className="object-cover" />
                </div>
              ))}
              {(graveyardView === "player" ? myField.graveyard : opponentField.graveyard).length === 0 && (
                <p className="col-span-4 text-slate-500 text-center py-8">Cemiterio vazio</p>
              )}
            </div>
          </div>
  </div>
  )}
  
  {/* Draw Card Animation - Card pulled from deck to hand */}
  {drawAnimation && (
  <div className="fixed inset-0 z-50 pointer-events-none overflow-hidden">
    {/* Card moving from deck position to hand */}
    <div className="draw-card-container">
      {/* Glow effect - follows card */}
      <div className="draw-card-glow" />
      
      {/* The card itself */}
      <div className="draw-card-frame">
        {/* Card back */}
        <div className="draw-card-back">
          <div className="absolute inset-1.5 border border-cyan-500/40 rounded" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 opacity-70" />
          </div>
        </div>
        
        {/* Card front */}
        <div className="draw-card-front">
          <img 
            src={drawAnimation.cardImage} 
            alt={drawAnimation.cardName}
            className="w-full h-full object-cover"
          />
          {/* Shine effect */}
          <div className="draw-card-shine" />
        </div>
      </div>
    </div>
    
    {/* Card name - appears at peak */}
    <div className="draw-card-name">
      <span className="text-white font-bold text-sm drop-shadow-lg">
        {drawAnimation.cardName}
      </span>
    </div>
  </div>
  )}
  
  {/* Card Inspection Overlay */}
  {inspectedCard && (
  <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90" onClick={() => setInspectedCard(null)}>
          <div className="relative">
            <div className="absolute -inset-20 bg-gradient-to-br from-cyan-500/15 to-purple-500/15 blur-3xl rounded-full" />
            <div className="relative rounded-3xl border-4 border-white/40 shadow-2xl overflow-hidden bg-slate-900 w-64 h-80">
              <Image src={inspectedCard.image || "/placeholder.svg"} alt={inspectedCard.name} fill className="object-contain" />
            </div>
            <div className="absolute -bottom-16 left-1/2 -translate-x-1/2 text-center w-80">
              <div className="text-white font-bold text-xl">{inspectedCard.name}</div>
              {isUnitCard(inspectedCard) && <div className="text-cyan-400 text-lg mt-1">{inspectedCard.dp} DP</div>}
              {inspectedCard.description && (
                <div className="text-slate-400 text-sm mt-2">{inspectedCard.description}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Dragged hand card ghost */}
      {draggedHandCard && (
        <div
          ref={draggedCardRef}
          className="fixed top-0 left-0 pointer-events-none z-[70]"
          style={{
            willChange: "transform",
            transform: `translate(${dragPosRef.current.x - 40}px, ${dragPosRef.current.y - 56}px) rotate(0deg) scale(1.1)`,
          }}
        >
          {/* Glow */}
          <div
            className={`absolute -inset-3 rounded-xl blur-xl transition-all duration-150 ${
              dropTarget ? "bg-green-400/60" : "bg-yellow-400/40"
            }`}
          />
          {/* Card */}
          <div
            className={`relative w-20 h-28 rounded-xl border-3 shadow-2xl overflow-hidden bg-slate-900 transition-all duration-100 ${
              dropTarget ? "border-green-400 shadow-green-500/60" : "border-yellow-400 shadow-yellow-500/50"
            }`}
          >
            <img
              src={draggedHandCard.card.image || "/placeholder.svg"}
              alt={draggedHandCard.card.name}
              className="w-full h-full object-cover"
              draggable={false}
            />
          </div>
        </div>
      )}

      {/* Card materialize in slot animation */}
      {droppingCard && (
        <div
          className="fixed pointer-events-none z-[80]"
          style={{
            left: droppingCard.targetX - 32,
            top: droppingCard.targetY - 44,
          }}
        >
          {/* Ring effect */}
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ animation: "summonRing 500ms ease-out forwards" }}
          >
            <div className="w-20 h-20 rounded-full border-2 border-cyan-400/80" />
          </div>
          {/* Glow burst */}
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ animation: "summonGlow 450ms ease-out forwards" }}
          >
            <div className="w-16 h-16 bg-cyan-400/50 rounded-full blur-2xl" />
          </div>
          {/* Card materializing */}
          <div
            className="relative rounded-lg border-2 border-cyan-400 shadow-xl shadow-cyan-500/60 overflow-hidden bg-slate-900"
            style={{
              width: "64px",
              height: "88px",
              animation: "cardMaterialize 500ms ease-out forwards",
              transformStyle: "preserve-3d",
            }}
          >
            <img
              src={droppingCard.card.image || "/placeholder.svg"}
              alt={droppingCard.card.name}
              className="w-full h-full object-cover"
              draggable={false}
            />
          </div>
        </div>
      )}
    </div>
  )
}
