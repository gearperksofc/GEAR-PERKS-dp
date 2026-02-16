"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { useLanguage } from "@/contexts/language-context"
import { useGame, type Deck, type Card } from "@/contexts/game-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ArrowLeft, Copy, Check, Send, Users, MessageCircle, Loader2, Smile, X } from "lucide-react"
import Image from "next/image"
import type { RealtimeChannel } from "@supabase/supabase-js"

// Emotes oficiais do jogo
const GAME_EMOTES = [
  { id: "emote-1", name: "Chorando de Alegria", image: "/images/emotes/emote-1.png" },
  { id: "emote-2", name: "Confiante", image: "/images/emotes/emote-2.png" },
  { id: "emote-3", name: "Raiva", image: "/images/emotes/emote-3.png" },
  { id: "emote-4", name: "Feliz", image: "/images/emotes/emote-4.png" },
  { id: "emote-5", name: "Surpreso", image: "/images/emotes/emote-5.png" },
  { id: "emote-6", name: "Fogo", image: "/images/emotes/emote-6.png" },
]

interface MultiplayerLobbyProps {
  onBack: () => void
  onStartDuel: (roomData: RoomData) => void
}

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

interface ChatMessage {
  id: string
  sender_id: string
  sender_name: string
  message: string
  created_at: string
}

type LobbyScreen = "choice" | "create" | "join" | "waiting" | "lobby"

export function MultiplayerLobby({ onBack, onStartDuel }: MultiplayerLobbyProps) {
  const { t } = useLanguage()
  const { decks, playerProfile, playerId } = useGame()
  const supabase = createClient()
  
  const [screen, setScreen] = useState<LobbyScreen>("choice")
  const [shouldStartDuel, setShouldStartDuel] = useState(false)
  const [roomCode, setRoomCode] = useState("")
  const [inputRoomCode, setInputRoomCode] = useState("")
  const [roomData, setRoomData] = useState<RoomData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [selectedDeck, setSelectedDeck] = useState<Deck | null>(decks[0] || null)
  
  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState("")
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const [showEmotePicker, setShowEmotePicker] = useState(false)
  
  // Ready state
  const [isReady, setIsReady] = useState(false)
  
  // Realtime channel ref
  const channelRef = useRef<RealtimeChannel | null>(null)
  const roomChannelRef = useRef<RealtimeChannel | null>(null)

  // Generate random room code
  const generateRoomCode = () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    let code = ""
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return code
  }

  // Create a new room
  const createRoom = async () => {
    setIsLoading(true)
    setError(null)
    
    try {
      const code = generateRoomCode()
      
      // Generate a valid UUID for the host if playerId is not a valid UUID
      const hostUUID = playerId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(playerId)
        ? playerId
        : crypto.randomUUID()
      
      console.log("[v0] Creating room...")
      console.log("[v0] Supabase URL:", process.env.NEXT_PUBLIC_SUPABASE_URL ? "SET" : "NOT SET")
      console.log("[v0] Room code:", code)
      console.log("[v0] Host UUID:", hostUUID)
      console.log("[v0] Host name:", playerProfile.name)
      
      const insertPayload = {
        room_code: code,
        host_id: hostUUID,
        host_name: playerProfile.name || "Jogador",
        host_deck: selectedDeck ? JSON.stringify(selectedDeck) : null,
        status: "waiting",
        host_ready: false,
        guest_ready: false,
      }
      console.log("[v0] Insert payload:", JSON.stringify(insertPayload, null, 2))
      
      const { data, error: insertError } = await supabase
        .from("duel_rooms")
        .insert(insertPayload)
        .select()
        .single()

      console.log("[v0] Insert response - data:", data, "error:", insertError)

      if (insertError) {
        console.error("[v0] Error creating room:", JSON.stringify(insertError, null, 2))
        setError(`Erro ao criar sala: ${insertError.message || "Tente novamente."}`)
        setIsLoading(false)
        return
      }
      
      if (!data) {
        console.error("[v0] No data returned from insert")
        setError("Erro ao criar sala: dados não retornados")
        setIsLoading(false)
        return
      }

      setRoomCode(code)
      setRoomData({
        roomId: data.id,
        roomCode: code,
        isHost: true,
        hostId: hostUUID,
        hostName: playerProfile.name || "Jogador",
        hostDeck: selectedDeck,
        guestId: null,
        guestName: null,
        guestDeck: null,
        hostReady: false,
        guestReady: false,
      })
      setScreen("waiting")
      
      // Subscribe to room changes
      subscribeToRoom(data.id, code)
      
    } catch (err) {
      console.error("[v0] Exception creating room:", err)
      setError(`Erro ao criar sala: ${err instanceof Error ? err.message : "Tente novamente."}`)
    }
    
    setIsLoading(false)
  }

  // Join an existing room
  const joinRoom = async () => {
    setIsLoading(true)
    setError(null)
    
    const codeToJoin = inputRoomCode.toUpperCase().trim()
    
    if (!codeToJoin || codeToJoin.length !== 6) {
      setError("Codigo invalido. Deve ter 6 caracteres.")
      setIsLoading(false)
      return
    }
    
    try {
      // Find the room
      const { data: room, error: findError } = await supabase
        .from("duel_rooms")
        .select("*")
        .eq("room_code", codeToJoin)
        .eq("status", "waiting")
        .single()

      if (findError || !room) {
        setError("Sala nao encontrada ou ja esta cheia.")
        setIsLoading(false)
        return
      }

      // Generate a valid UUID for the guest if playerId is not a valid UUID
      const guestUUID = playerId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(playerId)
        ? playerId
        : crypto.randomUUID()

      if (room.host_id === guestUUID) {
        setError("Voce nao pode entrar na sua propria sala.")
        setIsLoading(false)
        return
      }

      // Update room with guest info
      const { error: updateError } = await supabase
        .from("duel_rooms")
        .update({
          guest_id: guestUUID,
          guest_name: playerProfile.name || "Jogador",
          guest_deck: selectedDeck ? JSON.stringify(selectedDeck) : null,
          status: "lobby",
        })
        .eq("id", room.id)

      if (updateError) {
        console.log("[v0] Error joining room:", updateError)
        setError("Erro ao entrar na sala. Tente novamente.")
        setIsLoading(false)
        return
      }

      // Parse host deck safely
      let hostDeck = null
      if (room.host_deck) {
        try {
          hostDeck = typeof room.host_deck === 'string' 
            ? JSON.parse(room.host_deck) 
            : room.host_deck
        } catch {
          hostDeck = room.host_deck
        }
      }
      
      setRoomCode(codeToJoin)
      setRoomData({
        roomId: room.id,
        roomCode: codeToJoin,
        isHost: false,
        hostId: room.host_id,
        hostName: room.host_name,
        hostDeck: hostDeck,
        guestId: guestUUID,
        guestName: playerProfile.name,
        guestDeck: selectedDeck,
        hostReady: room.host_ready,
        guestReady: false,
      })
      setScreen("lobby")
      
      // Subscribe to room and chat
      subscribeToRoom(room.id, codeToJoin)
      subscribeToChat(room.id)
      
    } catch (err) {
      setError("Erro ao entrar na sala. Tente novamente.")
    }
    
    setIsLoading(false)
  }

  // Subscribe to room updates
  const subscribeToRoom = useCallback((roomId: string, code: string) => {
    console.log("[v0] subscribeToRoom called - roomId:", roomId, "code:", code)
    
    // Clean up existing subscription
    if (roomChannelRef.current) {
      roomChannelRef.current.unsubscribe()
    }

    const channel = supabase
      .channel(`room-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "duel_rooms",
          filter: `id=eq.${roomId}`,
        },
        (payload) => {
          const newData = payload.new as any
          
          setRoomData((prev) => {
            if (!prev) return prev
            
            // Parse guest deck safely - it might already be an object or a string
            let guestDeck = prev.guestDeck
            if (newData.guest_deck) {
              try {
                guestDeck = typeof newData.guest_deck === 'string'
                  ? JSON.parse(newData.guest_deck)
                  : newData.guest_deck
              } catch {
                guestDeck = newData.guest_deck
              }
            }
            
            // Parse host deck safely
            let hostDeck = prev.hostDeck
            if (newData.host_deck) {
              try {
                hostDeck = typeof newData.host_deck === 'string'
                  ? JSON.parse(newData.host_deck)
                  : newData.host_deck
              } catch {
                hostDeck = newData.host_deck
              }
            }
            
            console.log("[v0] Room update received!")
            console.log("[v0] - newData.status:", newData.status)
            console.log("[v0] - newData.guest_id:", newData.guest_id)
            console.log("[v0] - newData.guest_name:", newData.guest_name)
            console.log("[v0] - prev.isHost:", prev.isHost)
            console.log("[v0] - hostDeck:", hostDeck?.name, "guestDeck:", guestDeck?.name)
            
            const updated: RoomData = {
              ...prev,
              guestId: newData.guest_id,
              guestName: newData.guest_name,
              guestDeck: guestDeck,
              hostDeck: hostDeck,
              hostReady: newData.host_ready,
              guestReady: newData.guest_ready,
            }
            
            // If guest joined and we're the host, move to lobby
            console.log("[v0] Checking if should move to lobby:", prev.isHost, newData.guest_id, newData.status)
            if (prev.isHost && newData.guest_id && newData.status === "lobby") {
              console.log("[v0] Moving host to lobby screen!")
              setScreen("lobby")
              subscribeToChat(roomId)
            }
            
            // If both players are ready, signal to start the duel
            if (newData.status === "playing") {
              setShouldStartDuel(true)
            }
            
            return updated
          })
        }
      )
      .subscribe((status) => {
        console.log("[v0] Room subscription status:", status)
      })

    roomChannelRef.current = channel
  }, [supabase])

  // Effect to start duel when both players are ready
  useEffect(() => {
    if (shouldStartDuel && roomData) {
      onStartDuel(roomData)
    }
  }, [shouldStartDuel, roomData, onStartDuel])

  // Subscribe to chat messages
  const subscribeToChat = useCallback((roomId: string) => {
    // Clean up existing subscription
    if (channelRef.current) {
      channelRef.current.unsubscribe()
    }

    // Load existing messages
    const loadMessages = async () => {
      const { data } = await supabase
        .from("duel_chat")
        .select("*")
        .eq("room_id", roomId)
        .order("created_at", { ascending: true })
      
      if (data) {
        setChatMessages(data)
      }
    }
    loadMessages()

    const channel = supabase
      .channel(`chat-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "duel_chat",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          setChatMessages((prev) => [...prev, payload.new as ChatMessage])
        }
      )
      .subscribe()

    channelRef.current = channel
  }, [supabase])

  // Send chat message
  const sendMessage = async (messageText?: string) => {
    const message = messageText || chatInput.trim()
    if (!message || !roomData) return
    
    setChatInput("")
    setShowEmotePicker(false)
    
    // Generate a valid UUID for sender_id if playerId is not a valid UUID
    const senderUUID = playerId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(playerId)
      ? playerId
      : roomData.isHost ? roomData.hostId : (roomData.guestId || crypto.randomUUID())
    
    try {
      const { error: insertError } = await supabase
        .from("duel_chat")
        .insert({
          room_id: roomData.roomId,
          sender_id: senderUUID,
          sender_name: playerProfile.name || "Jogador",
          message: message,
        })
      
      if (insertError) {
        console.error("[v0] Error sending message:", insertError)
      }
    } catch (err) {
      console.error("[v0] Exception sending message:", err)
    }
  }
  
  // Send emote
  const sendEmote = (emoteId: string) => {
    const emote = GAME_EMOTES.find(e => e.id === emoteId)
    if (emote) {
      sendMessage(`[EMOTE:${emoteId}]`)
    }
  }

  // Toggle ready state
  const toggleReady = async () => {
    if (!roomData) return
    
    const newReadyState = !isReady
    setIsReady(newReadyState)
    
    const updateField = roomData.isHost ? "host_ready" : "guest_ready"
    
    await supabase
      .from("duel_rooms")
      .update({ [updateField]: newReadyState })
      .eq("id", roomData.roomId)
    
    // Check if both players are ready
    const otherReady = roomData.isHost ? roomData.guestReady : roomData.hostReady
    
    if (newReadyState && otherReady) {
      // Both ready - start the duel
      await supabase
        .from("duel_rooms")
        .update({ status: "playing" })
        .eq("id", roomData.roomId)
    }
  }

  // Copy room code to clipboard
  const copyRoomCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      // Failed to copy
    }
  }

  // Leave room
  const leaveRoom = async () => {
    if (roomData) {
      if (roomData.isHost) {
        // Delete the room if host leaves
        await supabase
          .from("duel_rooms")
          .delete()
          .eq("id", roomData.roomId)
      } else {
        // Remove guest from room
        await supabase
          .from("duel_rooms")
          .update({
            guest_id: null,
            guest_name: null,
            guest_deck: null,
            guest_ready: false,
            status: "waiting",
          })
          .eq("id", roomData.roomId)
      }
    }
    
    // Cleanup subscriptions
    if (channelRef.current) {
      channelRef.current.unsubscribe()
    }
    if (roomChannelRef.current) {
      roomChannelRef.current.unsubscribe()
    }
    
    onBack()
  }

  // Scroll chat to bottom
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight
    }
  }, [chatMessages])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (channelRef.current) {
        channelRef.current.unsubscribe()
      }
      if (roomChannelRef.current) {
        roomChannelRef.current.unsubscribe()
      }
    }
  }, [])

  // Check if other player is ready
  const otherPlayerReady = roomData?.isHost ? roomData.guestReady : roomData?.hostReady

  // Render choice screen
  if (screen === "choice") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 p-4">
        <div className="max-w-md mx-auto">
          <Button
            variant="ghost"
            onClick={onBack}
            className="text-white mb-6"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Voltar
          </Button>

          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-white mb-2">Duelo Online</h1>
            <p className="text-slate-400">Desafie outros jogadores em tempo real</p>
          </div>

          {/* Deck Selection */}
          <div className="bg-slate-800/50 rounded-xl p-4 mb-6 border border-slate-700">
            <h3 className="text-white font-semibold mb-3">Selecionar Deck</h3>
            <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
              {decks.map((deck) => (
                <button
                  key={deck.id}
                  onClick={() => setSelectedDeck(deck)}
                  className={`p-3 rounded-lg text-left transition-all ${
                    selectedDeck?.id === deck.id
                      ? "bg-amber-500/30 border-2 border-amber-500"
                      : "bg-slate-700/50 border border-slate-600 hover:bg-slate-700"
                  }`}
                >
                  <p className="text-white text-sm font-medium truncate">{deck.name}</p>
                  <p className="text-slate-400 text-xs">{deck.cards.length} cartas</p>
                </button>
              ))}
            </div>
            {decks.length === 0 && (
              <p className="text-slate-400 text-center py-4">
                Crie um deck primeiro para jogar online
              </p>
            )}
          </div>

          {/* Options */}
          <div className="space-y-4">
            <button
              onClick={() => setScreen("create")}
              disabled={!selectedDeck}
              className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:from-slate-600 disabled:to-slate-600 text-white font-bold py-4 px-6 rounded-xl transition-all flex items-center justify-center gap-3"
            >
              <Users className="w-6 h-6" />
              Criar Sala Privada
            </button>

            <button
              onClick={() => setScreen("join")}
              disabled={!selectedDeck}
              className="w-full bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 disabled:from-slate-600 disabled:to-slate-600 text-white font-bold py-4 px-6 rounded-xl transition-all flex items-center justify-center gap-3"
            >
              <MessageCircle className="w-6 h-6" />
              Entrar com Codigo
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Render create room screen
  if (screen === "create") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 p-4">
        <div className="max-w-md mx-auto">
          <Button
            variant="ghost"
            onClick={() => setScreen("choice")}
            className="text-white mb-6"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Voltar
          </Button>

          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-white mb-2">Criar Sala</h1>
            <p className="text-slate-400">Crie uma sala e compartilhe o codigo</p>
          </div>

          <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700 mb-6">
            <p className="text-slate-300 mb-4">
              Deck selecionado: <span className="text-amber-400 font-semibold">{selectedDeck?.name}</span>
            </p>
            
            <Button
              onClick={createRoom}
              disabled={isLoading}
              className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold py-4 rounded-xl"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Criando...
                </>
              ) : (
                "Criar Sala"
              )}
            </Button>

            {error && (
              <p className="text-red-400 text-sm mt-4 text-center">{error}</p>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Render join room screen
  if (screen === "join") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 p-4">
        <div className="max-w-md mx-auto">
          <Button
            variant="ghost"
            onClick={() => setScreen("choice")}
            className="text-white mb-6"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Voltar
          </Button>

          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-white mb-2">Entrar na Sala</h1>
            <p className="text-slate-400">Digite o codigo da sala para entrar</p>
          </div>

          <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700 mb-6">
            <p className="text-slate-300 mb-4">
              Deck selecionado: <span className="text-amber-400 font-semibold">{selectedDeck?.name}</span>
            </p>
            
            <Input
              value={inputRoomCode}
              onChange={(e) => setInputRoomCode(e.target.value.toUpperCase())}
              placeholder="CODIGO"
              maxLength={6}
              className="text-center text-2xl font-mono tracking-widest bg-slate-700 border-slate-600 text-white mb-4"
            />
            
            <Button
              onClick={joinRoom}
              disabled={isLoading || inputRoomCode.length !== 6}
              className="w-full bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-bold py-4 rounded-xl"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Entrando...
                </>
              ) : (
                "Entrar na Sala"
              )}
            </Button>

            {error && (
              <p className="text-red-400 text-sm mt-4 text-center">{error}</p>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Render waiting room screen (host waiting for guest)
  if (screen === "waiting") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 p-4">
        <div className="max-w-md mx-auto">
          <Button
            variant="ghost"
            onClick={leaveRoom}
            className="text-white mb-6"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Sair da Sala
          </Button>

          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-white mb-2">Aguardando Jogador</h1>
            <p className="text-slate-400">Compartilhe o codigo com seu oponente</p>
          </div>

          {/* Room Code Display */}
          <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700 mb-6">
            <p className="text-slate-400 text-sm mb-2 text-center">Codigo da Sala</p>
            <div className="flex items-center justify-center gap-3">
              <span className="text-4xl font-mono font-bold text-amber-400 tracking-widest">
                {roomCode}
              </span>
              <button
                onClick={copyRoomCode}
                className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
              >
                {copied ? (
                  <Check className="w-5 h-5 text-green-400" />
                ) : (
                  <Copy className="w-5 h-5 text-slate-300" />
                )}
              </button>
            </div>
          </div>

          {/* Waiting Animation */}
          <div className="bg-slate-800/50 rounded-xl p-8 border border-slate-700 text-center">
            <div className="flex justify-center mb-4">
              <Loader2 className="w-12 h-12 text-amber-400 animate-spin" />
            </div>
            <p className="text-white font-medium">Esperando outro jogador entrar...</p>
            <p className="text-slate-400 text-sm mt-2">
              Deck: {selectedDeck?.name}
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Render lobby screen (both players present)
  if (screen === "lobby" && roomData) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 p-4">
        <div className="max-w-lg mx-auto">
          <Button
            variant="ghost"
            onClick={leaveRoom}
            className="text-white mb-4"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Sair da Sala
          </Button>

          <div className="text-center mb-4">
            <h1 className="text-xl font-bold text-white mb-1">Sala: {roomCode}</h1>
          </div>

          {/* Players Display */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            {/* Host */}
            <div className={`bg-slate-800/50 rounded-xl p-4 border-2 transition-colors ${
              roomData.hostReady ? "border-green-500" : "border-slate-700"
            }`}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-12 h-12 rounded-full bg-amber-500/30 flex items-center justify-center overflow-hidden border-2 border-amber-500/50">
                  {roomData.isHost && playerProfile.avatarUrl ? (
                    <Image 
                      src={playerProfile.avatarUrl} 
                      alt={roomData.hostName} 
                      width={48} 
                      height={48} 
                      className="object-cover w-full h-full"
                    />
                  ) : (
                    <span className="text-amber-400 font-bold text-lg">{roomData.hostName?.charAt(0)?.toUpperCase() || "H"}</span>
                  )}
                </div>
                <div>
                  <p className="text-white font-medium text-sm truncate">{roomData.hostName}</p>
                  <p className="text-xs text-slate-400">Anfitriao</p>
                </div>
              </div>
              {roomData.hostDeck && (
                <p className="text-xs text-slate-400 truncate">
                  Deck: {roomData.hostDeck.name}
                </p>
              )}
              <div className={`mt-2 py-1 px-2 rounded text-xs font-medium text-center ${
                roomData.hostReady 
                  ? "bg-green-500/30 text-green-400" 
                  : "bg-red-500/30 text-red-400"
              }`}>
                {roomData.hostReady ? "PRONTO!" : "ESPERANDO"}
              </div>
            </div>

            {/* Guest */}
            <div className={`bg-slate-800/50 rounded-xl p-4 border-2 transition-colors ${
              roomData.guestReady ? "border-green-500" : "border-slate-700"
            }`}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-12 h-12 rounded-full bg-blue-500/30 flex items-center justify-center overflow-hidden border-2 border-blue-500/50">
                  {!roomData.isHost && playerProfile.avatarUrl ? (
                    <Image 
                      src={playerProfile.avatarUrl} 
                      alt={roomData.guestName || "Guest"} 
                      width={48} 
                      height={48} 
                      className="object-cover w-full h-full"
                    />
                  ) : roomData.guestName ? (
                    <span className="text-blue-400 font-bold text-lg">{roomData.guestName.charAt(0).toUpperCase()}</span>
                  ) : (
                    <Users className="w-5 h-5 text-blue-400" />
                  )}
                </div>
                <div>
                  <p className="text-white font-medium text-sm truncate">
                    {roomData.guestName || "Aguardando..."}
                  </p>
                  <p className="text-xs text-slate-400">Convidado</p>
                </div>
              </div>
              {roomData.guestDeck && (
                <p className="text-xs text-slate-400 truncate">
                  Deck: {roomData.guestDeck.name}
                </p>
              )}
              {roomData.guestId && (
                <div className={`mt-2 py-1 px-2 rounded text-xs font-medium text-center ${
                  roomData.guestReady 
                    ? "bg-green-500/30 text-green-400" 
                    : "bg-red-500/30 text-red-400"
                }`}>
                  {roomData.guestReady ? "PRONTO!" : "ESPERANDO"}
                </div>
              )}
            </div>
          </div>

          {/* Chat */}
          <div className="bg-slate-800/50 rounded-xl border border-slate-700 mb-4">
            <div className="p-3 border-b border-slate-700">
              <h3 className="text-white font-medium flex items-center gap-2">
                <MessageCircle className="w-4 h-4" />
                Chat
              </h3>
            </div>
            
            <div 
              ref={chatContainerRef}
              className="h-40 overflow-y-auto p-3 space-y-2"
            >
              {chatMessages.length === 0 ? (
                <p className="text-slate-500 text-sm text-center py-4">
                  Nenhuma mensagem ainda...
                </p>
              ) : (
                chatMessages.map((msg) => {
                  // Check if message is an emote
                  const emoteMatch = msg.message.match(/^\[EMOTE:(emote-\d+)\]$/)
                  const isEmote = !!emoteMatch
                  const emote = isEmote ? GAME_EMOTES.find(e => e.id === emoteMatch![1]) : null
                  
                  // Check if this is from the current player (compare with both playerId and room IDs)
                  const isCurrentPlayer = msg.sender_id === playerId || 
                    (roomData?.isHost && msg.sender_id === roomData.hostId) ||
                    (!roomData?.isHost && msg.sender_id === roomData?.guestId)
                  
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${
                        isCurrentPlayer ? "items-end" : "items-start"
                      }`}
                    >
                      <span className="text-xs text-slate-500 mb-1">
                        {msg.sender_name}
                      </span>
                      {isEmote && emote ? (
                        <div className="relative w-24 h-24 bg-slate-800/50 rounded-xl p-1">
                          <Image
                            src={emote.image}
                            alt={emote.name}
                            fill
                            className="object-contain drop-shadow-lg"
                          />
                        </div>
                      ) : (
                        <div className={`max-w-[80%] px-3 py-2 rounded-lg ${
                          isCurrentPlayer
                            ? "bg-amber-500/30 text-amber-100"
                            : "bg-slate-700 text-slate-200"
                        }`}>
                          <p className="text-sm break-words">{msg.message}</p>
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>

            <div className="p-3 border-t border-slate-700 relative">
              {/* Emote Picker */}
              {showEmotePicker && (
                <div className="absolute bottom-full left-0 right-0 mb-2 bg-slate-800 rounded-xl border border-slate-600 p-3 shadow-xl z-10">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-white text-sm font-medium">Emotes</span>
                    <button 
                      onClick={() => setShowEmotePicker(false)}
                      className="text-slate-400 hover:text-white"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {GAME_EMOTES.map((emote) => (
                      <button
                        key={emote.id}
                        onClick={() => sendEmote(emote.id)}
                        className="w-16 h-16 rounded-xl bg-slate-700 hover:bg-slate-600 hover:scale-110 transition-all p-1 relative"
                        title={emote.name}
                      >
                        <Image
                          src={emote.image}
                          alt={emote.name}
                          fill
                          className="object-contain p-1"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  sendMessage()
                }}
                className="flex gap-2"
              >
                <Input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Digite uma mensagem..."
                  className="flex-1 bg-slate-700 border-slate-600 text-white text-sm"
                  maxLength={200}
                />
                <Button
                  type="button"
                  onClick={() => setShowEmotePicker(!showEmotePicker)}
                  className="bg-slate-600 hover:bg-slate-500 text-white"
                >
                  <Smile className="w-4 h-4" />
                </Button>
                <Button
                  type="submit"
                  disabled={!chatInput.trim()}
                  className="bg-amber-500 hover:bg-amber-600 text-white"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </form>
            </div>
          </div>

          {/* Ready Button */}
          <button
            onClick={toggleReady}
            className={`w-full py-4 px-6 rounded-xl font-bold text-lg transition-all ${
              isReady
                ? "bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white"
                : "bg-gradient-to-r from-red-500 to-rose-500 hover:from-red-600 hover:to-rose-600 text-white"
            }`}
          >
            {isReady ? "PRONTO!" : "ESPERANDO"}
          </button>

          {isReady && !otherPlayerReady && (
            <p className="text-slate-400 text-sm text-center mt-3">
              Aguardando o outro jogador ficar pronto...
            </p>
          )}

          {isReady && otherPlayerReady && (
            <div className="text-center mt-4">
              <Loader2 className="w-8 h-8 text-green-400 animate-spin mx-auto mb-2" />
              <p className="text-green-400 font-medium">Iniciando duelo...</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  return null
}
