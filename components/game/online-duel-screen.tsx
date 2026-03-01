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
  hostAvatar?: string | null
  guestId: string | null
  guestName: string | null
  guestDeck: Deck | null
  guestAvatar?: string | null
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
  attackerSource: "unit" | "ultimate"
  targetInfo?: { type: "unit" | "direct"; index?: number } | null
}

// ==========================================
// CENTRALIZED FUNCTION CARD EFFECT SYSTEM (ported from bot mode)
// ==========================================

interface FunctionCardEffect {
  id: string
  name: string
  requiresTargets: boolean
  requiresChoice?: boolean
  requiresDice?: boolean
  choiceOptions?: { id: string; label: string; description: string }[]
  targetConfig?: { enemyUnits?: number; allyUnits?: number }
  needsDrawAfterResolve?: boolean
  canActivate: (context: PvPEffectContext) => { canActivate: boolean; reason?: string }
  resolve: (context: PvPEffectContext, targets?: PvPEffectTargets) => PvPEffectResult
}

interface PvPEffectContext {
  playerField: FieldState
  enemyField: FieldState
  setPlayerField: React.Dispatch<React.SetStateAction<FieldState>>
  setEnemyField: React.Dispatch<React.SetStateAction<FieldState>>
}

interface PvPEffectTargets {
  enemyUnitIndices?: number[]
  allyUnitIndices?: number[]
  chosenOption?: string
  diceResult?: number
}

interface PvPEffectResult {
  success: boolean
  message?: string
  needsDrawAndCheck?: boolean
  needsDrawAndCheckUnit?: boolean
  needsDrawOnly?: boolean
  currentLife?: number
  broadcastDamage?: { target: "direct" | "unit"; amount: number; targetIndex?: number; cardName: string }
}

// Registry of all Function card effects - mirrors bot mode exactly
const PVP_FUNCTION_CARD_EFFECTS: Record<string, FunctionCardEffect> = {
  "amplificador-de-poder": {
    id: "amplificador-de-poder",
    name: "Amplificador de Poder",
    requiresTargets: true,
    targetConfig: { enemyUnits: 1, allyUnits: 1 },
    canActivate: (context) => {
      const hasEnemyUnits = context.enemyField.unitZone.some((u) => u !== null)
      const hasPlayerUnits = context.playerField.unitZone.some((u) => u !== null)
      if (!hasEnemyUnits) return { canActivate: false, reason: "Nenhuma unidade inimiga no campo" }
      if (!hasPlayerUnits) return { canActivate: false, reason: "Nenhuma unidade aliada no campo" }
      return { canActivate: true }
    },
    resolve: (context, targets) => {
      if (!targets?.enemyUnitIndices?.length || !targets?.allyUnitIndices?.length)
        return { success: false, message: "Alvos invalidos" }
      const enemyIndex = targets.enemyUnitIndices[0]
      const allyIndex = targets.allyUnitIndices[0]
      const enemyUnit = context.enemyField.unitZone[enemyIndex]
      const allyUnit = context.playerField.unitZone[allyIndex]
      if (!enemyUnit || !allyUnit) return { success: false, message: "Unidades nao encontradas" }
      const dpBonus = enemyUnit.dp
      const allyCurrentDp = allyUnit.currentDp || allyUnit.dp
      const newDp = allyCurrentDp + dpBonus
      context.setPlayerField((prev) => {
        const newUnitZone = [...prev.unitZone]
        if (newUnitZone[allyIndex]) newUnitZone[allyIndex] = { ...newUnitZone[allyIndex]!, currentDp: newDp }
        return { ...prev, unitZone: newUnitZone }
      })
      return { success: true, message: `+${dpBonus} DP aplicado! (${allyCurrentDp} -> ${newDp})` }
    },
  },
  "bandagem-restauradora": {
    id: "bandagem-restauradora",
    name: "Bandagem Restauradora",
    requiresTargets: false,
    canActivate: (context) => {
      if (context.playerField.life >= 20) return { canActivate: false, reason: "LP ja esta no maximo" }
      return { canActivate: true }
    },
    resolve: (context) => {
      const currentLife = context.playerField.life
      const healAmount = Math.min(2, 20 - currentLife)
      const newLife = Math.min(currentLife + healAmount, 20)
      context.setPlayerField((prev) => ({ ...prev, life: newLife }))
      return { success: true, message: `+${healAmount} LP restaurado! (${currentLife} -> ${newLife})` }
    },
  },
  "adaga-energizada": {
    id: "adaga-energizada",
    name: "Adaga Energizada",
    requiresTargets: false,
    canActivate: (context) => {
      const enemyUnitCount = context.enemyField.unitZone.filter((u) => u !== null).length
      if (enemyUnitCount < 2) return { canActivate: false, reason: "O oponente precisa ter 2 ou mais unidades" }
      return { canActivate: true }
    },
    resolve: (context) => {
      const currentEnemyLife = context.enemyField.life
      const newEnemyLife = Math.max(0, currentEnemyLife - 4)
      context.setEnemyField((prev) => ({ ...prev, life: newEnemyLife }))
      return { success: true, message: `4 de dano direto! LP: ${currentEnemyLife} -> ${newEnemyLife}`, broadcastDamage: { target: "direct", amount: 4, cardName: "Adaga Energizada" } }
    },
  },
  "bandagens-duplas": {
    id: "bandagens-duplas",
    name: "Bandagens Duplas",
    requiresTargets: false,
    canActivate: (context) => {
      if (context.playerField.life >= 20) return { canActivate: false, reason: "LP ja esta no maximo" }
      return { canActivate: true }
    },
    resolve: (context) => {
      const currentLife = context.playerField.life
      const healAmount = Math.min(4, 20 - currentLife)
      const newLife = Math.min(currentLife + healAmount, 20)
      context.setPlayerField((prev) => ({ ...prev, life: newLife }))
      return { success: true, message: `+${healAmount} LP restaurado! (${currentLife} -> ${newLife})` }
    },
  },
  "cristal-recuperador": {
    id: "cristal-recuperador",
    name: "Cristal Recuperador",
    requiresTargets: false,
    needsDrawAfterResolve: true,
    canActivate: (context) => {
      if (context.playerField.life >= 20) return { canActivate: false, reason: "LP ja esta no maximo" }
      return { canActivate: true }
    },
    resolve: (context) => {
      const currentLife = context.playerField.life
      const healAmount = Math.min(3, 20 - currentLife)
      const newLife = Math.min(currentLife + healAmount, 20)
      context.setPlayerField((prev) => ({ ...prev, life: newLife }))
      return { success: true, message: `+${healAmount} LP restaurado! (${currentLife} -> ${newLife})`, needsDrawAndCheck: true, currentLife: newLife }
    },
  },
  "cauda-de-dragao-assada": {
    id: "cauda-de-dragao-assada",
    name: "Cauda de Dragão Assada",
    requiresTargets: false,
    canActivate: (context) => {
      const playerUnitCount = context.playerField.unitZone.filter((u) => u !== null).length
      if (playerUnitCount < 2) return { canActivate: false, reason: "Voce precisa ter 2 ou mais unidades" }
      return { canActivate: true }
    },
    resolve: (context) => {
      const currentLife = context.playerField.life
      const healAmount = Math.min(2, 20 - currentLife)
      const newLife = Math.min(currentLife + healAmount, 20)
      context.setPlayerField((prev) => ({
        ...prev,
        life: newLife,
        unitZone: prev.unitZone.map((unit) => unit === null ? null : { ...unit, currentDp: (unit.currentDp || unit.dp) + 1 }),
      }))
      const unitCount = context.playerField.unitZone.filter((u) => u !== null).length
      const healMsg = healAmount > 0 ? ` +${healAmount} LP` : ""
      return { success: true, message: `+1 DP para ${unitCount} unidades!${healMsg}` }
    },
  },
  "projetil-de-impacto": {
    id: "projetil-de-impacto",
    name: "Projetil de Impacto",
    requiresTargets: false,
    canActivate: () => ({ canActivate: true }),
    resolve: (context) => {
      const currentEnemyLife = context.enemyField.life
      const newEnemyLife = Math.max(0, currentEnemyLife - 2)
      context.setEnemyField((prev) => ({ ...prev, life: newEnemyLife }))
      return { success: true, message: `2 de dano direto! LP: ${currentEnemyLife} -> ${newEnemyLife}`, broadcastDamage: { target: "direct", amount: 2, cardName: "Projetil de Impacto" } }
    },
  },
  "veu-dos-lacos-cruzados": {
    id: "veu-dos-lacos-cruzados",
    name: "Veu dos Lacos Cruzados",
    requiresTargets: true,
    requiresChoice: true,
    choiceOptions: [
      { id: "buff", label: "+2 DP em Fehnon/Jaden", description: "Adiciona 2 DP a uma unidade Fehnon Hoskie ou Jaden Hainaegi sua" },
      { id: "debuff", label: "-2 DP em inimigo", description: "Reduz 2 DP de uma unidade do oponente" },
    ],
    targetConfig: { allyUnits: 1 },
    canActivate: (context) => {
      const hasRequiredUnit = context.playerField.unitZone.some((u) => u !== null && (u.name === "Fehnon Hoskie" || u.name === "Jaden Hainaegi"))
      if (!hasRequiredUnit) return { canActivate: false, reason: "Voce precisa ter Fehnon Hoskie ou Jaden Hainaegi no campo" }
      return { canActivate: true }
    },
    resolve: (context, targets) => {
      const chosenOption = targets?.chosenOption
      if (chosenOption === "buff") {
        if (!targets?.allyUnitIndices?.length) return { success: false, message: "Selecione uma unidade Fehnon ou Jaden" }
        const allyIndex = targets.allyUnitIndices[0]
        const allyUnit = context.playerField.unitZone[allyIndex]
        if (!allyUnit || (allyUnit.name !== "Fehnon Hoskie" && allyUnit.name !== "Jaden Hainaegi"))
          return { success: false, message: "Selecione Fehnon Hoskie ou Jaden Hainaegi" }
        const currentDp = allyUnit.currentDp || allyUnit.dp
        const newDp = currentDp + 2
        context.setPlayerField((prev) => {
          const newUnitZone = [...prev.unitZone]
          if (newUnitZone[allyIndex]) newUnitZone[allyIndex] = { ...newUnitZone[allyIndex]!, currentDp: newDp }
          return { ...prev, unitZone: newUnitZone }
        })
        return { success: true, message: `${allyUnit.name} recebeu +2 DP! (${currentDp} -> ${newDp})` }
      } else if (chosenOption === "debuff") {
        if (!targets?.enemyUnitIndices?.length) return { success: false, message: "Selecione uma unidade inimiga" }
        const enemyIndex = targets.enemyUnitIndices[0]
        const enemyUnit = context.enemyField.unitZone[enemyIndex]
        if (!enemyUnit) return { success: false, message: "Unidade inimiga nao encontrada" }
        const currentDp = enemyUnit.currentDp || enemyUnit.dp
        const newDp = Math.max(0, currentDp - 2)
        context.setEnemyField((prev) => {
          const newUnitZone = [...prev.unitZone]
          if (newUnitZone[enemyIndex]) newUnitZone[enemyIndex] = { ...newUnitZone[enemyIndex]!, currentDp: newDp }
          return { ...prev, unitZone: newUnitZone }
        })
        return { success: true, message: `${enemyUnit.name} perdeu 2 DP! (${currentDp} -> ${newDp})`, broadcastDamage: { target: "unit", amount: 2, targetIndex: enemyIndex, cardName: "Veu dos Lacos Cruzados" } }
      }
      return { success: false, message: "Escolha uma opcao" }
    },
  },
  "nucleo-explosivo": {
    id: "nucleo-explosivo",
    name: "Nucleo Explosivo",
    requiresTargets: false,
    canActivate: (context) => {
      if (context.enemyField.unitZone.filter((u) => u !== null).length === 0)
        return { canActivate: false, reason: "O oponente precisa ter ao menos 1 unidade" }
      return { canActivate: true }
    },
    resolve: (context) => {
      let unitsHit = 0
      context.setEnemyField((prev) => ({
        ...prev,
        unitZone: prev.unitZone.map((unit) => {
          if (unit === null) return null
          unitsHit++
          return { ...unit, currentDp: Math.max(0, (unit.currentDp || unit.dp) - 1) }
        }),
      }))
      return { success: true, message: `1 de dano em ${unitsHit} unidade(s) inimigas!` }
    },
  },
  "kit-medico-improvisado": {
    id: "kit-medico-improvisado",
    name: "Kit Medico Improvisado",
    requiresTargets: false,
    needsDrawAfterResolve: true,
    canActivate: (context) => {
      if (context.playerField.life >= 20) return { canActivate: false, reason: "LP ja esta no maximo" }
      return { canActivate: true }
    },
    resolve: (context) => {
      const currentLife = context.playerField.life
      const healAmount = Math.min(2, 20 - currentLife)
      const newLife = Math.min(currentLife + healAmount, 20)
      context.setPlayerField((prev) => ({ ...prev, life: newLife }))
      return { success: true, message: `+${healAmount} LP restaurado! (${currentLife} -> ${newLife})`, needsDrawAndCheckUnit: true, currentLife: newLife }
    },
  },
  "soro-recuperador": {
    id: "soro-recuperador",
    name: "Soro Recuperador",
    requiresTargets: false,
    needsDrawAfterResolve: true,
    canActivate: (context) => {
      if (context.playerField.life >= 20) return { canActivate: false, reason: "LP ja esta no maximo" }
      return { canActivate: true }
    },
    resolve: (context) => {
      const currentLife = context.playerField.life
      const healAmount = Math.min(3, 20 - currentLife)
      const newLife = Math.min(currentLife + healAmount, 20)
      context.setPlayerField((prev) => ({ ...prev, life: newLife }))
      return { success: true, message: `+${healAmount} LP restaurado! (${currentLife} -> ${newLife})`, needsDrawOnly: true, currentLife: newLife }
    },
  },
  "ordem-de-laceracao": {
    id: "ordem-de-laceracao",
    name: "Ordem de Laceracao",
    requiresTargets: false,
    canActivate: (context) => {
      const hasFehnon = context.playerField.unitZone.some((u) => u !== null && u.name === "Fehnon Hoskie")
      if (!hasFehnon) return { canActivate: false, reason: "Voce precisa ter Fehnon Hoskie no campo" }
      return { canActivate: true }
    },
    resolve: (context) => {
      const currentEnemyLife = context.enemyField.life
      const newEnemyLife = Math.max(0, currentEnemyLife - 3)
      context.setEnemyField((prev) => ({ ...prev, life: newEnemyLife }))
      return { success: true, message: `3 de dano direto! LP: ${currentEnemyLife} -> ${newEnemyLife}`, broadcastDamage: { target: "direct", amount: 3, cardName: "Ordem de Laceracao" } }
    },
  },
  "sinfonia-relampago": {
    id: "sinfonia-relampago",
    name: "Sinfonia Relampago",
    requiresTargets: false,
    canActivate: (context) => {
      const hasMorgana = context.playerField.unitZone.some((u) => u !== null && u.name === "Morgana Pendragon")
      if (!hasMorgana) return { canActivate: false, reason: "Voce precisa ter Morgana Pendragon no campo" }
      return { canActivate: true }
    },
    resolve: (context) => {
      const currentEnemyLife = context.enemyField.life
      const newEnemyLife = Math.max(0, currentEnemyLife - 4)
      context.setEnemyField((prev) => ({ ...prev, life: newEnemyLife }))
      return { success: true, message: `4 de dano direto! LP: ${currentEnemyLife} -> ${newEnemyLife}`, broadcastDamage: { target: "direct", amount: 4, cardName: "Sinfonia Relampago" } }
    },
  },
  "fafnisbani": {
    id: "fafnisbani",
    name: "Fafnisbani",
    requiresTargets: true,
    requiresChoice: true,
    choiceOptions: [
      { id: "unit", label: "Atacar Unidade", description: "Causa 3 de dano a uma unidade inimiga" },
      { id: "lp", label: "Atacar LP", description: "Causa 3 de dano direto ao LP do oponente" },
    ],
    canActivate: (context) => {
      const hasHrotti = context.playerField.unitZone.some((u) => u !== null && (u.name === "Scandinavian Angel Hrotti" || u.name?.toLowerCase().includes("hrotti")))
      if (!hasHrotti) return { canActivate: false, reason: "Voce precisa ter Scandinavian Angel Hrotti no campo" }
      return { canActivate: true }
    },
    resolve: (context, targets) => {
      const chosenOption = targets?.chosenOption
      if (chosenOption === "lp") {
        const currentEnemyLife = context.enemyField.life
        const newEnemyLife = Math.max(0, currentEnemyLife - 3)
        context.setEnemyField((prev) => ({ ...prev, life: newEnemyLife }))
        return { success: true, message: `Fafnisbani! 3 de dano direto! LP: ${currentEnemyLife} -> ${newEnemyLife}`, broadcastDamage: { target: "direct", amount: 3, cardName: "Fafnisbani" } }
      } else if (chosenOption === "unit") {
        if (!targets?.enemyUnitIndices?.length) return { success: false, message: "Selecione uma unidade inimiga" }
        const enemyIndex = targets.enemyUnitIndices[0]
        const enemyUnit = context.enemyField.unitZone[enemyIndex]
        if (!enemyUnit) return { success: false, message: "Unidade inimiga nao encontrada" }
        const currentDp = enemyUnit.currentDp || enemyUnit.dp
        const newDp = Math.max(0, currentDp - 3)
        const isDestroyed = newDp <= 0
        context.setEnemyField((prev) => {
          const newUnitZone = [...prev.unitZone]
          const newGraveyard = [...prev.graveyard]
          if (isDestroyed) {
            if (newUnitZone[enemyIndex]) newGraveyard.push(newUnitZone[enemyIndex]!)
            newUnitZone[enemyIndex] = null
          } else {
            if (newUnitZone[enemyIndex]) newUnitZone[enemyIndex] = { ...newUnitZone[enemyIndex]!, currentDp: newDp }
          }
          return { ...prev, unitZone: newUnitZone, graveyard: newGraveyard }
        })
        return { success: true, message: isDestroyed ? `Fafnisbani! ${enemyUnit.name} destruido!` : `Fafnisbani! ${enemyUnit.name} -3 DP (${currentDp} -> ${newDp})`, broadcastDamage: { target: "unit", amount: 3, targetIndex: enemyIndex, cardName: "Fafnisbani" } }
      }
      return { success: false, message: "Escolha uma opcao" }
    },
  },
  "devorar-o-mundo": {
    id: "devorar-o-mundo",
    name: "Devorar o Mundo",
    requiresTargets: true,
    requiresChoice: true,
    choiceOptions: [
      { id: "unit", label: "Atacar Unidade", description: "Causa 4 de dano a uma unidade inimiga" },
      { id: "lp", label: "Atacar LP", description: "Causa 4 de dano direto ao LP do oponente" },
    ],
    canActivate: (context) => {
      const hasLogi = context.playerField.unitZone.some((u) => u !== null && (u.name === "Scandinavian Angel Logi" || u.name?.toLowerCase().includes("logi")))
      if (!hasLogi) return { canActivate: false, reason: "Voce precisa ter Scandinavian Angel Logi no campo" }
      return { canActivate: true }
    },
    resolve: (context, targets) => {
      const chosenOption = targets?.chosenOption
      if (chosenOption === "lp") {
        const currentEnemyLife = context.enemyField.life
        const newEnemyLife = Math.max(0, currentEnemyLife - 4)
        context.setEnemyField((prev) => ({ ...prev, life: newEnemyLife }))
        return { success: true, message: `Devorar o Mundo! 4 de dano direto! LP: ${currentEnemyLife} -> ${newEnemyLife}`, broadcastDamage: { target: "direct", amount: 4, cardName: "Devorar o Mundo" } }
      } else if (chosenOption === "unit") {
        if (!targets?.enemyUnitIndices?.length) return { success: false, message: "Selecione uma unidade inimiga" }
        const enemyIndex = targets.enemyUnitIndices[0]
        const enemyUnit = context.enemyField.unitZone[enemyIndex]
        if (!enemyUnit) return { success: false, message: "Unidade inimiga nao encontrada" }
        const currentDp = enemyUnit.currentDp || enemyUnit.dp
        const newDp = Math.max(0, currentDp - 4)
        const isDestroyed = newDp <= 0
        context.setEnemyField((prev) => {
          const newUnitZone = [...prev.unitZone]
          const newGraveyard = [...prev.graveyard]
          if (isDestroyed) {
            if (newUnitZone[enemyIndex]) newGraveyard.push(newUnitZone[enemyIndex]!)
            newUnitZone[enemyIndex] = null
          } else {
            if (newUnitZone[enemyIndex]) newUnitZone[enemyIndex] = { ...newUnitZone[enemyIndex]!, currentDp: newDp }
          }
          return { ...prev, unitZone: newUnitZone, graveyard: newGraveyard }
        })
        return { success: true, message: isDestroyed ? `Devorar o Mundo! ${enemyUnit.name} destruido!` : `Devorar o Mundo! ${enemyUnit.name} -4 DP (${currentDp} -> ${newDp})`, broadcastDamage: { target: "unit", amount: 4, targetIndex: enemyIndex, cardName: "Devorar o Mundo" } }
      }
      return { success: false, message: "Escolha uma opcao" }
    },
  },
  "dados-do-destino-gentil": {
    id: "dados-do-destino-gentil",
    name: "Dados do Destino Gentil",
    requiresTargets: true,
    requiresDice: true,
    targetConfig: { allyUnits: 1 },
    canActivate: (context) => {
      if (!context.playerField.unitZone.some((u) => u !== null)) return { canActivate: false, reason: "Voce precisa ter uma unidade em campo" }
      return { canActivate: true }
    },
    resolve: (context, targets) => {
      if (!targets?.allyUnitIndices?.length) return { success: false, message: "Selecione uma unidade sua" }
      const allyIndex = targets.allyUnitIndices[0]
      const allyUnit = context.playerField.unitZone[allyIndex]
      if (!allyUnit) return { success: false, message: "Unidade nao encontrada" }
      const diceResult = targets.diceResult || 1
      const currentDp = allyUnit.currentDp || allyUnit.dp
      if (diceResult >= 1 && diceResult <= 3) {
        const newDp = Math.max(0, currentDp - 3)
        const isDestroyed = newDp <= 0
        context.setPlayerField((prev) => {
          const newUnitZone = [...prev.unitZone]
          const newGraveyard = [...prev.graveyard]
          if (isDestroyed) { if (newUnitZone[allyIndex]) newGraveyard.push(newUnitZone[allyIndex]!); newUnitZone[allyIndex] = null }
          else { if (newUnitZone[allyIndex]) newUnitZone[allyIndex] = { ...newUnitZone[allyIndex]!, currentDp: newDp } }
          return { ...prev, unitZone: newUnitZone, graveyard: newGraveyard }
        })
        return { success: true, message: isDestroyed ? `Dado: ${diceResult}! ${allyUnit.name} destruida!` : `Dado: ${diceResult}! ${allyUnit.name} -3 DP (${currentDp} -> ${newDp})` }
      } else {
        const newDp = currentDp + 5
        context.setPlayerField((prev) => {
          const newUnitZone = [...prev.unitZone]
          if (newUnitZone[allyIndex]) newUnitZone[allyIndex] = { ...newUnitZone[allyIndex]!, currentDp: newDp }
          return { ...prev, unitZone: newUnitZone }
        })
        return { success: true, message: `Dado: ${diceResult}! ${allyUnit.name} +5 DP! (${currentDp} -> ${newDp})` }
      }
    },
  },
  "dados-do-cataclismo": {
    id: "dados-do-cataclismo",
    name: "Dados do Cataclismo",
    requiresTargets: true,
    requiresDice: true,
    targetConfig: { allyUnits: 1 },
    canActivate: (context) => {
      if (!context.playerField.unitZone.some((u) => u !== null)) return { canActivate: false, reason: "Voce precisa ter uma unidade em campo" }
      return { canActivate: true }
    },
    resolve: (context, targets) => {
      if (!targets?.allyUnitIndices?.length) return { success: false, message: "Selecione uma unidade sua" }
      const allyIndex = targets.allyUnitIndices[0]
      const allyUnit = context.playerField.unitZone[allyIndex]
      if (!allyUnit) return { success: false, message: "Unidade nao encontrada" }
      const diceResult = targets.diceResult || 1
      const currentDp = allyUnit.currentDp || allyUnit.dp
      if (diceResult >= 1 && diceResult <= 3) {
        return { success: true, message: `Dado: ${diceResult}! Nenhuma unidade recebe bonus.` }
      } else {
        const newDp = currentDp + 6
        context.setPlayerField((prev) => {
          const newUnitZone = [...prev.unitZone]
          if (newUnitZone[allyIndex]) newUnitZone[allyIndex] = { ...newUnitZone[allyIndex]!, currentDp: newDp }
          return { ...prev, unitZone: newUnitZone }
        })
        let extraMsg = ""
        if (diceResult === 6) {
          const enemyUnits = context.enemyField.unitZone
          let bestIdx = -1
          let bestDp = -1
          enemyUnits.forEach((u, idx) => { if (u && (u as FieldCard).currentDp > bestDp) { bestDp = (u as FieldCard).currentDp; bestIdx = idx } })
          if (bestIdx !== -1) {
            const enemyUnit = enemyUnits[bestIdx]!
            const enemyCurrentDp = (enemyUnit as FieldCard).currentDp
            const enemyNewDp = Math.max(0, enemyCurrentDp - 3)
            const enemyDestroyed = enemyNewDp <= 0
            context.setEnemyField((prev) => {
              const newEnemyUnits = [...prev.unitZone]
              const newGraveyard = [...prev.graveyard]
              if (enemyDestroyed) { if (newEnemyUnits[bestIdx]) newGraveyard.push(newEnemyUnits[bestIdx]!); newEnemyUnits[bestIdx] = null }
              else { if (newEnemyUnits[bestIdx]) newEnemyUnits[bestIdx] = { ...newEnemyUnits[bestIdx]!, currentDp: enemyNewDp } as FieldCard }
              return { ...prev, unitZone: newEnemyUnits, graveyard: newGraveyard }
            })
            extraMsg = enemyDestroyed
              ? ` CRITICO! ${enemyUnit.name} inimiga destruida!`
              : ` CRITICO! ${enemyUnit.name} inimiga -3 DP! (${enemyCurrentDp} -> ${enemyNewDp})`
          }
        }
        return { success: true, message: `Dado: ${diceResult}! ${allyUnit.name} +6 DP! (${currentDp} -> ${newDp})${extraMsg}`, broadcastDamage: diceResult === 6 ? { target: "unit", amount: 3, cardName: "Dados do Cataclismo" } : undefined }
      }
    },
  },
}

// Helper: extract base card ID
const getBaseCardIdPvP = (cardId: string): string => {
  const deckSuffixIndex = cardId.lastIndexOf("-deck-")
  if (deckSuffixIndex !== -1) return cardId.substring(0, deckSuffixIndex)
  return cardId.replace(/-\d{13,}$/, "")
}

// Helper: get effect for a card by ID or name (with accent-insensitive fallback)
const getPvPFunctionCardEffect = (card: { id: string; name?: string }): FunctionCardEffect | null => {
  const baseId = getBaseCardIdPvP(card.id)
  if (PVP_FUNCTION_CARD_EFFECTS[baseId]) return PVP_FUNCTION_CARD_EFFECTS[baseId]
  // Fallback: match by name (accent-insensitive)
  const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  const cardNameNorm = normalize(card.name || "")
  const effectByName = Object.values(PVP_FUNCTION_CARD_EFFECTS).find(
    (effect) => normalize(effect.name) === cardNameNorm
  )
  return effectByName || null
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
    card.type === "troops" ||
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
    attackerSource: "unit",
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
  const [dropTarget, setDropTarget] = useState<{ type: "unit" | "function" | "scenario" | "ultimate"; index: number } | null>(null)

  // Attack arrow state
  const [arrowPos, setArrowPos] = useState({ x1: 0, y1: 0, x2: 0, y2: 0 })

  // Refs
  const actionsChannelRef = useRef<RealtimeChannel | null>(null)
  const chatChannelRef = useRef<RealtimeChannel | null>(null)
  const fieldRef = useRef<HTMLDivElement>(null)
  const cardPressTimer = useRef<NodeJS.Timeout | null>(null)
  const positionRef = useRef({ startX: 0, startY: 0, currentX: 0, currentY: 0, lastTargetCheck: 0 })
  const gameResultRecordedRef = useRef(false)
  const draggedCardRef = useRef<HTMLDivElement>(null)
  const dragPosRef = useRef({ x: 0, y: 0, rotation: 0, lastCheck: 0 })
  const [droppingCard, setDroppingCard] = useState<{
    card: GameCard
    targetX: number
    targetY: number
  } | null>(null)
  
  // Effect feedback
  const [effectFeedback, setEffectFeedback] = useState<{ active: boolean; message: string; type: "success" | "error" } | null>(null)
  
  const showEffectFeedback = useCallback((message: string, type: "success" | "error") => {
    setEffectFeedback({ active: true, message, type })
    setTimeout(() => setEffectFeedback(null), 2500)
  }, [])

  // Element glow helper
  const getElementGlow = (element: string): string => {
    const el = element?.toLowerCase()
    switch (el) {
      case "aquos": case "aquo": return "rgba(0, 191, 255, 0.8)"
      case "fire": case "pyrus": return "rgba(255, 69, 0, 0.8)"
      case "ventus": return "rgba(50, 205, 50, 0.8)"
      case "darkness": case "darkus": case "dark": return "rgba(153, 50, 204, 0.8)"
      case "lightness": case "haos": case "light": return "rgba(255, 215, 0, 0.8)"
      case "void": return "rgba(233, 69, 96, 0.8)"
      default: return "rgba(255, 255, 255, 0.8)"
    }
  }

  // Trigger explosion animation at a point
  const triggerExplosion = useCallback((targetX: number, targetY: number, element: string) => {
    const colors = getElementColors(element)
    const el = element?.toLowerCase()
    const particles: { x: number; y: number; vx: number; vy: number; size: number; alpha: number; color: string }[] = []

    // Generate particles based on element
    for (let i = 0; i < 60; i++) {
      const angle = (Math.PI * 2 * i) / 60 + Math.random() * 0.3
      const speed = 5 + Math.random() * 10
      particles.push({ x: targetX, y: targetY, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 4, size: 5 + Math.random() * 12, color: colors[Math.floor(Math.random() * colors.length)], alpha: 1 })
    }
    // White core
    for (let i = 0; i < 20; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 2 + Math.random() * 4
      particles.push({ x: targetX, y: targetY, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, size: 15 + Math.random() * 25, color: "#ffffff", alpha: 0.8 })
    }
    // Sparks
    for (let i = 0; i < 30; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 8 + Math.random() * 8
      particles.push({ x: targetX, y: targetY, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 4, size: 2 + Math.random() * 4, color: "#ffffff", alpha: 1 })
    }

    // Element-specific bonus particles
    if (el === "fire" || el === "pyrus") {
      for (let ring = 0; ring < 3; ring++) {
        for (let i = 0; i < 35; i++) {
          const angle = (Math.PI * 2 * i) / 35; const speed = (4 + ring * 3) + Math.random() * 3
          particles.push({ x: targetX, y: targetY, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, size: 5 + Math.random() * 8, color: ring === 0 ? "#ff4500" : ring === 1 ? "#ff8c00" : "#ffa500", alpha: 0.9 })
        }
      }
    } else if (el === "aquos" || el === "aquo") {
      for (let ring = 0; ring < 4; ring++) {
        for (let i = 0; i < 25; i++) {
          const angle = (Math.PI * 2 * i) / 25; const speed = (3 + ring * 2) + Math.random() * 2
          particles.push({ x: targetX, y: targetY, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, size: 6 + Math.random() * 10, color: colors[Math.floor(Math.random() * colors.length)], alpha: 0.85 })
        }
      }
    } else if (el === "ventus") {
      for (let helix = 0; helix < 2; helix++) {
        for (let i = 0; i < 40; i++) {
          const spiralAngle = (i / 40) * Math.PI * 8 + helix * Math.PI; const radius = 5 + (i / 40) * 80; const speed = 5 + Math.random() * 8
          particles.push({ x: targetX + Math.cos(spiralAngle) * radius * 0.4, y: targetY + Math.sin(spiralAngle) * radius * 0.4, vx: Math.cos(spiralAngle + Math.PI / 2) * speed, vy: Math.sin(spiralAngle + Math.PI / 2) * speed - 4, size: 5 + Math.random() * 10, color: colors[Math.floor(Math.random() * colors.length)], alpha: 0.9 })
        }
      }
    } else if (el === "darkness" || el === "darkus" || el === "dark") {
      for (let i = 0; i < 12; i++) {
        const baseAngle = (Math.PI * 2 * i) / 12
        for (let j = 0; j < 10; j++) {
          particles.push({ x: targetX + Math.cos(baseAngle) * j * 5, y: targetY + Math.sin(baseAngle) * j * 5, vx: Math.cos(baseAngle) * (3 + j * 0.6), vy: Math.sin(baseAngle) * (3 + j * 0.6), size: 14 - j * 0.7, color: j % 3 === 0 ? "#4b0082" : j % 3 === 1 ? "#9932cc" : "#800080", alpha: 0.9 - j * 0.04 })
        }
      }
    } else if (el === "lightness" || el === "haos" || el === "light") {
      for (let i = 0; i < 12; i++) {
        const rayAngle = (Math.PI * 2 * i) / 12
        for (let j = 0; j < 8; j++) {
          particles.push({ x: targetX, y: targetY, vx: Math.cos(rayAngle) * (5 + j * 2.5), vy: Math.sin(rayAngle) * (5 + j * 2.5), size: 18 - j * 1.5, color: j % 2 === 0 ? "#ffffff" : "#ffd700", alpha: 1 - j * 0.08 })
        }
      }
    } else if (el === "void") {
      for (let i = 0; i < 10; i++) {
        const baseAngle = (Math.PI * 2 * i) / 10
        for (let j = 0; j < 10; j++) {
          const jitter = (Math.random() - 0.5) * 0.6
          particles.push({ x: targetX, y: targetY, vx: Math.cos(baseAngle + jitter) * (4 + j * 1.3), vy: Math.sin(baseAngle + jitter) * (4 + j * 1.3), size: 5 + Math.random() * 5, color: j % 4 === 0 ? "#e94560" : j % 4 === 1 ? "#533483" : j % 4 === 2 ? "#0f3460" : "#ff1493", alpha: 1 - j * 0.04 })
        }
      }
    }

    const effectId = `explosion-${Date.now()}`
    setExplosionEffects((prev) => [...prev, { id: effectId, x: targetX, y: targetY, element, particles, startTime: Date.now() }])

    const flashColors: Record<string, string> = { aquos: "rgba(0, 191, 255, 0.4)", aquo: "rgba(0, 191, 255, 0.4)", fire: "rgba(255, 100, 0, 0.5)", pyrus: "rgba(255, 100, 0, 0.5)", ventus: "rgba(50, 205, 50, 0.35)", darkness: "rgba(128, 0, 128, 0.45)", darkus: "rgba(128, 0, 128, 0.45)", dark: "rgba(128, 0, 128, 0.45)", lightness: "rgba(255, 255, 200, 0.5)", haos: "rgba(255, 255, 200, 0.5)", light: "rgba(255, 255, 200, 0.5)", void: "rgba(233, 69, 96, 0.45)" }
    setImpactFlash({ active: true, color: flashColors[el] || "rgba(255, 255, 255, 0.3)" })
    setTimeout(() => setImpactFlash({ active: false, color: "#ffffff" }), 200)
    setTimeout(() => setExplosionEffects((prev) => prev.filter((e) => e.id !== effectId)), 3000)
  }, [])

  // Canvas animation loop for explosions
  useEffect(() => {
    for (const effect of explosionEffects) {
      if (!activeParticlesRef.current.has(effect.id)) {
        activeParticlesRef.current.set(effect.id, { particles: effect.particles.map((p) => ({ ...p })), startTime: effect.startTime, element: effect.element, x: effect.x, y: effect.y })
      }
    }
    const currentIds = new Set(explosionEffects.map((e) => e.id))
    for (const id of activeParticlesRef.current.keys()) { if (!currentIds.has(id)) activeParticlesRef.current.delete(id) }
    if (activeParticlesRef.current.size === 0) return

    const canvas = explosionCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    canvas.width = window.innerWidth; canvas.height = window.innerHeight

    let animationId: number
    const duration = 2600
    const animate = () => {
      const now = Date.now()
      const activeEffects = activeParticlesRef.current
      if (activeEffects.size === 0) { ctx.clearRect(0, 0, canvas.width, canvas.height); return }
      const localEffects = Array.from(activeEffects.entries())
      const allDone = localEffects.every(([, eff]) => now - eff.startTime > duration)
      if (allDone) { ctx.clearRect(0, 0, canvas.width, canvas.height); return }
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      localEffects.forEach(([, effect]) => {
        const elapsed = now - effect.startTime
        if (elapsed > duration) return
        const el = effect.element?.toLowerCase()
        const colors = getElementColors(effect.element)

        // Element-specific canvas effects
        if (el === "aquos" || el === "aquo") {
          for (let ring = 0; ring < 4; ring++) {
            const rp = Math.min(1, (elapsed - ring * 80) / 500)
            if (rp > 0 && rp < 1) { ctx.save(); ctx.globalAlpha = (1 - rp) * 0.5; ctx.strokeStyle = ring % 2 === 0 ? "#00bfff" : "#40e0d0"; ctx.lineWidth = 3 * (1 - rp); ctx.shadowColor = "#00ffff"; ctx.shadowBlur = 15; ctx.beginPath(); ctx.arc(effect.x, effect.y, rp * 180, 0, Math.PI * 2); ctx.stroke(); ctx.restore() }
          }
        } else if (el === "fire" || el === "pyrus") {
          const fp = Math.min(1, elapsed / 350)
          if (fp < 1) { ctx.save(); ctx.globalAlpha = (1 - fp) * 0.7; ctx.strokeStyle = "#ff6600"; ctx.lineWidth = 6 * (1 - fp); ctx.shadowColor = "#ff4500"; ctx.shadowBlur = 30; ctx.beginPath(); ctx.arc(effect.x, effect.y, fp * 160, 0, Math.PI * 2); ctx.stroke(); ctx.restore() }
          for (let i = 0; i < 8; i++) { const la = (Math.PI * 2 * i) / 8; const lp = Math.min(1, elapsed / 400); if (lp < 1) { ctx.save(); ctx.globalAlpha = (1 - lp) * 0.6; ctx.strokeStyle = "#ffcc00"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(effect.x, effect.y); ctx.lineTo(effect.x + Math.cos(la) * lp * 120, effect.y + Math.sin(la) * lp * 120); ctx.stroke(); ctx.restore() } }
        } else if (el === "ventus") {
          const sp = Math.min(1, elapsed / 600)
          if (sp < 1) { ctx.save(); ctx.globalAlpha = (1 - sp) * 0.6; ctx.strokeStyle = "#32cd32"; ctx.lineWidth = 2; ctx.shadowColor = "#00ff00"; ctx.shadowBlur = 15; ctx.beginPath(); for (let a = 0; a < Math.PI * 6; a += 0.1) { const r = a * 8 * sp; const x = effect.x + Math.cos(a + elapsed * 0.01) * r; const y = effect.y + Math.sin(a + elapsed * 0.01) * r; if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y) }; ctx.stroke(); ctx.restore() }
        } else if (el === "darkness" || el === "darkus" || el === "dark") {
          const va = Math.max(0, 1 - elapsed / 800) * (Math.sin(elapsed * 0.02) * 0.3 + 0.7)
          if (va > 0) { const g = ctx.createRadialGradient(effect.x, effect.y, 0, effect.x, effect.y, 90); g.addColorStop(0, `rgba(20, 0, 40, ${va})`); g.addColorStop(0.5, `rgba(75, 0, 130, ${va * 0.6})`); g.addColorStop(1, "transparent"); ctx.fillStyle = g; ctx.fillRect(effect.x - 90, effect.y - 90, 180, 180) }
          for (let i = 0; i < 8; i++) { const ta = (Math.PI * 2 * i) / 8; const tp = Math.min(1, elapsed / 500); if (tp < 1) { ctx.save(); ctx.globalAlpha = (1 - tp) * 0.7; ctx.strokeStyle = "#9932cc"; ctx.lineWidth = 4 * (1 - tp * 0.5); ctx.shadowColor = "#800080"; ctx.shadowBlur = 20; ctx.beginPath(); ctx.moveTo(effect.x, effect.y); const segs = 5; for (let s = 1; s <= segs; s++) { const sp2 = s / segs; const w = Math.sin(s * 2 + elapsed * 0.01) * 15; ctx.lineTo(effect.x + Math.cos(ta) * tp * 100 * sp2 + Math.cos(ta + Math.PI / 2) * w, effect.y + Math.sin(ta) * tp * 100 * sp2 + Math.sin(ta + Math.PI / 2) * w) }; ctx.stroke(); ctx.restore() } }
        } else if (el === "lightness" || el === "haos" || el === "light") {
          const fa = Math.max(0, 1 - elapsed / 200)
          if (fa > 0) { ctx.save(); ctx.globalAlpha = fa; ctx.fillStyle = "#ffffff"; ctx.shadowColor = "#ffd700"; ctx.shadowBlur = 60; ctx.beginPath(); ctx.arc(effect.x, effect.y, 50 * (1 - elapsed / 300), 0, Math.PI * 2); ctx.fill(); ctx.restore() }
          for (let i = 0; i < 12; i++) { const ra = (Math.PI * 2 * i) / 12; const rp = Math.min(1, elapsed / 450); if (rp < 1) { ctx.save(); ctx.globalAlpha = (1 - rp) * 0.6; ctx.strokeStyle = i % 2 === 0 ? "#ffd700" : "#ffffff"; ctx.lineWidth = 4 * (1 - rp); ctx.shadowColor = "#ffff00"; ctx.shadowBlur = 20; ctx.beginPath(); ctx.moveTo(effect.x, effect.y); ctx.lineTo(effect.x + Math.cos(ra) * rp * 150, effect.y + Math.sin(ra) * rp * 150); ctx.stroke(); ctx.restore() } }
        } else if (el === "void") {
          for (let ring = 0; ring < 3; ring++) { const rp = Math.min(1, (elapsed - ring * 100) / 500); if (rp > 0 && rp < 1) { ctx.save(); ctx.globalAlpha = (1 - rp) * 0.6; ctx.strokeStyle = ring === 0 ? "#e94560" : ring === 1 ? "#533483" : "#0f3460"; ctx.lineWidth = 3; ctx.shadowColor = "#e94560"; ctx.shadowBlur = 15; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.arc(effect.x, effect.y, rp * 140, 0, Math.PI * 2); ctx.stroke(); ctx.restore() } }
        } else {
          const sp = Math.min(1, elapsed / 400)
          if (sp < 1) { ctx.save(); ctx.globalAlpha = (1 - sp) * 0.6; ctx.strokeStyle = colors[0]; ctx.lineWidth = 4 * (1 - sp); ctx.shadowColor = colors[0]; ctx.shadowBlur = 20; ctx.beginPath(); ctx.arc(effect.x, effect.y, sp * 150, 0, Math.PI * 2); ctx.stroke(); ctx.restore() }
        }

        // Draw particles with physics
        effect.particles.forEach((p) => {
          const pel = el
          if (pel === "aquos" || pel === "aquo") { p.vy += 0.08; p.vx *= 0.97 }
          else if (pel === "fire" || pel === "pyrus") { p.vy -= 0.02; p.vy += 0.05; p.vx *= 0.96 }
          else if (pel === "ventus") { p.vx *= 0.99; p.vy += 0.03 }
          else if (pel === "darkness" || pel === "darkus" || pel === "dark") { p.vy += 0.05; p.vx *= 0.98 }
          else if (pel === "lightness" || pel === "haos" || pel === "light") { p.vy += 0.02; p.vx *= 0.995 }
          else if (pel === "void") { p.vx += (Math.random() - 0.5) * 0.3; p.vy += (Math.random() - 0.5) * 0.3; p.vy += 0.04 }
          else { p.vy += 0.12; p.vx *= 0.98 }
          p.x += p.vx; p.y += p.vy; p.alpha -= 0.012; p.size *= 0.97
          if (p.alpha > 0 && p.size > 0.5) { ctx.save(); ctx.globalAlpha = Math.max(0, p.alpha); ctx.fillStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = p.size > 10 ? 30 : 15; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.1, p.size), 0, Math.PI * 2); ctx.fill(); ctx.restore() }
        })

        // Central glow
        const ga = Math.max(0, 1 - elapsed / 700)
        if (ga > 0) { const g = ctx.createRadialGradient(effect.x, effect.y, 0, effect.x, effect.y, 140); g.addColorStop(0, getElementGlow(effect.element).replace("0.8", String(ga * 0.6))); g.addColorStop(0.5, getElementGlow(effect.element).replace("0.8", String(ga * 0.25))); g.addColorStop(1, "transparent"); ctx.fillStyle = g; ctx.fillRect(effect.x - 140, effect.y - 140, 280, 280) }
      })

      animationId = requestAnimationFrame(animate)
    }
    animationId = requestAnimationFrame(animate)
    return () => { if (animationId) cancelAnimationFrame(animationId) }
  }, [explosionEffects])

  // Item / Function card effect selection mode
  const [itemSelectionMode, setItemSelectionMode] = useState<{
    active: boolean
    itemCard: GameCard | null
    effect: FunctionCardEffect | null
    step: "choice" | "dice" | "selectEnemy" | "selectAlly"
    selectedEnemyIndex: number | null
    selectedAllyIndex: number | null
    chosenOption: string | null
    diceResult: number | null
    handIndex: number | null
  }>({ active: false, itemCard: null, effect: null, step: "selectEnemy", selectedEnemyIndex: null, selectedAllyIndex: null, chosenOption: null, diceResult: null, handIndex: null })

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
    setTimeout(() => setDrawAnimation(null), 2000)
  }, [])

  // Ultimate Gear/Guardian ability tracking
  const [playerUgAbilityUsed, setPlayerUgAbilityUsed] = useState(false)
  const [showUgActivateBtn, setShowUgActivateBtn] = useState(false)
  const [ugTargetMode, setUgTargetMode] = useState<{
    active: boolean
    ugCard: GameCard | null
    type: "oden_sword" | "twiligh_avalon" | "kensei_ifraid" | "mefisto_foles" | "nightmare_armageddon" | "vatnavordr_messiham" | "yggdra_nidhogg" | null
  }>({ active: false, ugCard: null, type: null })

  // Explosion / attack animation state
  interface Particle { x: number; y: number; vx: number; vy: number; size: number; alpha: number; color: string }
  interface ExplosionEffect { id: string; x: number; y: number; element: string; particles: Particle[]; startTime: number }
  const [explosionEffects, setExplosionEffects] = useState<ExplosionEffect[]>([])
  const explosionCanvasRef = useRef<HTMLCanvasElement>(null)
  const activeParticlesRef = useRef<Map<string, { particles: Particle[]; startTime: number; element: string; x: number; y: number }>>(new Map())
  const [impactFlash, setImpactFlash] = useState<{ active: boolean; color: string }>({ active: false, color: "#ffffff" })

  // Attack system refs for smooth dragging
  const isDraggingRef = useRef(false)
  const enemyUnitRectsRef = useRef<DOMRect[]>([])

  // Track previous unit zone for auto-applying UG passive bonuses
  const prevUnitZoneRef = useRef<(string | null)[]>([])

  // Get my deck and opponent deck
  const myDeck = roomData.isHost ? roomData.hostDeck : roomData.guestDeck
  const opponentDeck = roomData.isHost ? roomData.guestDeck : roomData.hostDeck
  const opponentName = roomData.isHost ? roomData.guestName : roomData.hostName

  // Ref to always have latest handleOpponentAction (must be declared before useEffect that uses it)
  const handleOpponentActionRef = useRef<(action: DuelAction) => void>(() => {})

  // UG Passive Bonus: when required unit appears on field after Ultimate is placed, apply DP bonus
  useEffect(() => {
    if (!myField.ultimateZone) {
      prevUnitZoneRef.current = myField.unitZone.map((u) => u?.name || null)
      return
    }
    const ug = myField.ultimateZone
    const requiredUnit = ug.requiresUnit
    const ability = ug.ability
    const prevNames = prevUnitZoneRef.current
    const currentNames = myField.unitZone.map((u) => u?.name || null)

    // Element-based equips (ISGRIMM, RAGNA, SKUGGI)
    const elementEquips: Record<string, { element: string; bonus: number }> = {
      "ISGRIMM FENRIR": { element: "Ventus", bonus: 2 },
      "RAGNA GULLINKAMBI": { element: "Haos", bonus: 3 },
      "SKUGGI DRAUGR": { element: "Darkus", bonus: 3 },
    }
    const elemConfig = ability ? elementEquips[ability] : undefined
    if (elemConfig && !requiredUnit) {
      for (let i = 0; i < myField.unitZone.length; i++) {
        const unit = myField.unitZone[i]
        if (unit && unit.element === elemConfig.element && !prevNames.includes(unit.name)) {
          setMyField((prev) => {
            const newUnits = [...prev.unitZone]
            const u = newUnits[i]
            if (!u || u.element !== elemConfig.element) return prev
            newUnits[i] = { ...u, currentDp: u.currentDp + elemConfig.bonus }
            return { ...prev, unitZone: newUnits as (FieldCard | null)[] }
          })
          showEffectFeedback(`${unit.name} +${elemConfig.bonus} DP (${ability})!`, "success")
          break
        }
      }
      prevUnitZoneRef.current = currentNames
      return
    }

    if (!requiredUnit) { prevUnitZoneRef.current = currentNames; return }

    const wasPresent = prevNames.some((n) => n === requiredUnit)
    const isNowPresent = currentNames.some((n) => n === requiredUnit)

    if (!wasPresent && isNowPresent) {
      const unitIdx = myField.unitZone.findIndex((u) => u && u.name === requiredUnit)
      if (unitIdx !== -1) {
        setMyField((prev) => {
          const newUnits = [...prev.unitZone]
          const unit = newUnits[unitIdx]
          if (!unit) return prev
          let bonus = 0; let msg = ""
          if (ability === "ODEN SWORD") { bonus = 4; msg = `${requiredUnit} +4 DP (Oden Sword)!` }
          else if (ability === "PROTONIX SWORD") { bonus = 2; msg = `${requiredUnit} +2 DP (Protonix Sword)!` }
          else if (ability === "TWILIGH AVALON") { bonus = 2; msg = `${requiredUnit} +2 DP (Twiligh Avalon)!` }
          else if (ability === "ULLRBOGI") { msg = `${requiredUnit} recebera +3 DP nas fases de batalha (Ullrbogi)!` }
          else if (ability === "KENSEI IFRAID") { bonus = 3; msg = `${requiredUnit} +3 DP (Kensei Ifraid)!` }
          else if (ability === "MEFISTO FOLES") { bonus = 2; msg = `${requiredUnit} +2 DP (Mefisto Foles)!` }
          else if (ability === "NIGHTMARE ARMAGEDDON") { bonus = 7; msg = `${requiredUnit} +7 DP (Nightmare Armageddon)!` }
          else if (ability === "VATNAVORDR MESSIHAM") { bonus = 2; msg = `${requiredUnit} +2 DP (Vatnavordr Messiham)!` }
          else if (ability === "YGGDRA NIDHOGG") { bonus = 3; msg = `${requiredUnit} +3 DP (Yggdra Nidhogg)!` }
          else if (ability === "FORNBRENNA") {
            const fireUnitsUsed = prev.graveyard.filter((c) => c.type === "unit" && (c.element === "Fire" || c.element === "Pyrus")).length
            bonus = fireUnitsUsed * 2; msg = `${requiredUnit} +${bonus} DP (Fornbrenna, ${fireUnitsUsed} unidades de fogo)!`
          }
          if (bonus > 0) newUnits[unitIdx] = { ...unit, currentDp: unit.currentDp + bonus }
          if (msg) showEffectFeedback(msg, "success")
          return bonus > 0 ? { ...prev, unitZone: newUnits as (FieldCard | null)[] } : prev
        })
      }
    }
    prevUnitZoneRef.current = currentNames
  }, [myField.unitZone, myField.ultimateZone, showEffectFeedback])

  // Initialize game
  useEffect(() => {
    if (!myDeck) return

    // Shuffle deck and draw initial hand
    const shuffledDeck = shuffleArray([...myDeck.cards])
    const initialHand = shuffledDeck.slice(0, 5)
    const remainingDeck = shuffledDeck.slice(5)

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

    // Subscribe to game actions via Broadcast (fast WebSocket, no DB round-trip)
    const actionsChannel = supabase
      .channel(`duel-broadcast-${roomData.roomId}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "game-action" }, ({ payload }) => {
        if (payload && payload.playerId !== playerId) {
          handleOpponentActionRef.current(payload as DuelAction)
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          // Send initial state to opponent via Broadcast
          actionsChannel.send({
            type: "broadcast",
            event: "game-action",
            payload: {
              type: "draw",
              playerId,
              data: { handSize: initialHand.length, deckSize: remainingDeck.length },
              timestamp: Date.now(),
            },
          })
        }
      })
    actionsChannelRef.current = actionsChannel

    // Subscribe to chat
    subscribeToChat()

    return () => {
      if (actionsChannelRef.current) {
        supabase.removeChannel(actionsChannelRef.current)
      }
      if (chatChannelRef.current) {
        supabase.removeChannel(chatChannelRef.current)
      }
    }
  }, [])

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

  // Send action via Broadcast (instant) + fire-and-forget DB persist
  const sendAction = useCallback((action: DuelAction) => {
    // Instant delivery via WebSocket Broadcast
    if (actionsChannelRef.current) {
      actionsChannelRef.current.send({
        type: "broadcast",
        event: "game-action",
        payload: action,
      })
    }

    // Fire-and-forget DB persist for replay/recovery (non-blocking)
    supabase.from("duel_actions").insert({
      room_id: roomData.roomId,
      player_id: playerId,
      action_type: action.type,
      action_data: JSON.stringify(action),
    }).then(({ error }) => {
      if (error) console.error("DB persist error:", error)
    })
  }, [supabase, roomData.roomId, playerId])

  // Handle opponent's action - uses functional state updates everywhere to avoid stale closures
  const handleOpponentAction = useCallback((action: DuelAction) => {
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
              canAttackTurn: turnRef.current,
            }
            return {
              ...prev,
              unitZone: newUnitZone,
              hand: prev.hand.length > 0 ? prev.hand.slice(0, -1) : prev.hand,
            }
          })
        } else if (action.data.zone === "function") {
          setOpponentField((prev) => {
            const newFunctionZone = [...prev.functionZone]
            newFunctionZone[action.data.index] = action.data.card
            return {
              ...prev,
              functionZone: newFunctionZone,
              hand: prev.hand.length > 0 ? prev.hand.slice(0, -1) : prev.hand,
            }
          })
        }
        break

      case "place_scenario":
        setOpponentField((prev) => ({
          ...prev,
          scenarioZone: action.data.card,
          hand: prev.hand.length > 0 ? prev.hand.slice(0, -1) : prev.hand,
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
              canAttackTurn: turnRef.current,
            },
            hand: prev.hand.length > 0 ? prev.hand.slice(0, -1) : prev.hand,
          }
        })
        break

      case "attack": {
        const { attackerIndex, attackerSource, targetType, targetIndex, damage } = action.data
        const isUltimateAttacker = attackerSource === "ultimate"

        // Determine attacker element for explosion animation
        const attackerUnit = isUltimateAttacker
          ? opponentFieldRef.current.ultimateZone
          : opponentFieldRef.current.unitZone[attackerIndex]
        const attackerElement = attackerUnit?.element || "neutral"

        if (targetType === "direct") {
          // Explosion on our life zone
          setTimeout(() => {
            const lifeZone = document.querySelector("[data-player-life]")
            const lifeRect = lifeZone?.getBoundingClientRect()
            if (lifeRect) triggerExplosion(lifeRect.left + lifeRect.width / 2, lifeRect.top + lifeRect.height / 2, attackerElement)
          }, 100)
          setMyField((prev) => ({
            ...prev,
            life: Math.max(0, prev.life - damage),
          }))
        } else if (targetType === "unit") {
          // Explosion on our unit
          setTimeout(() => {
            const el = document.querySelector(`[data-player-unit-slot="${targetIndex}"]`)
            const rect = el?.getBoundingClientRect()
            if (rect) triggerExplosion(rect.left + rect.width / 2, rect.top + rect.height / 2, attackerElement)
          }, 100)
          // Apply damage to my unit
          setMyField((prev) => {
            const newUnitZone = [...prev.unitZone]
            const newGraveyard = [...prev.graveyard]
            const target = newUnitZone[targetIndex]
            if (target) {
              const newDp = target.currentDp - damage
              if (newDp <= 0) {
                newGraveyard.push({ ...target, currentDp: 0 })
                newUnitZone[targetIndex] = null
              } else {
                newUnitZone[targetIndex] = { ...target, currentDp: newDp }
              }
            }
            return { ...prev, unitZone: newUnitZone, graveyard: newGraveyard }
          })

          // Attacker takes counter damage
          setOpponentField((prev) => {
            if (isUltimateAttacker && prev.ultimateZone && action.data.counterDamage) {
              const newDp = prev.ultimateZone.currentDp - action.data.counterDamage
              const updated = { ...prev.ultimateZone, currentDp: newDp, hasAttacked: true, canAttack: false }
              if (newDp <= 0) {
                return { ...prev, ultimateZone: null, graveyard: [...prev.graveyard, { ...updated, currentDp: 0 }] }
              }
              return { ...prev, ultimateZone: updated }
            } else {
              const newUnitZone = [...prev.unitZone]
              const newGraveyard = [...prev.graveyard]
              const attacker = newUnitZone[attackerIndex]
              if (attacker && action.data.counterDamage) {
                const newDp = attacker.currentDp - action.data.counterDamage
                if (newDp <= 0) {
                  newGraveyard.push({ ...attacker, currentDp: 0 })
                  newUnitZone[attackerIndex] = null
                } else {
                  newUnitZone[attackerIndex] = { ...attacker, currentDp: newDp }
                }
              }
              return { ...prev, unitZone: newUnitZone, graveyard: newGraveyard }
            }
          })
        }

        // Mark attacker as having attacked
        setOpponentField((prev) => {
          if (isUltimateAttacker && prev.ultimateZone) {
            return { ...prev, ultimateZone: { ...prev.ultimateZone, hasAttacked: true, canAttack: false } }
          }
          const newUnitZone = [...prev.unitZone]
          const attacker = newUnitZone[attackerIndex]
          if (attacker) {
            newUnitZone[attackerIndex] = { ...attacker, hasAttacked: true, canAttack: false }
          }
          return { ...prev, unitZone: newUnitZone }
        })
        break
      }

      case "damage":
        if (action.data.target === "player" || action.data.target === "direct") {
          setMyField((prev) => ({
            ...prev,
            life: Math.max(0, prev.life - action.data.amount),
          }))
          if (action.data.cardName) {
            showEffectFeedback(`${action.data.cardName}: -${action.data.amount} LP!`, "error")
          }
        } else if (action.data.target === "unit" && action.data.targetIndex !== undefined) {
          // Opponent played a damage effect card that hit our unit
          setMyField((prev) => {
            const newUnitZone = [...prev.unitZone]
            const newGraveyard = [...prev.graveyard]
            const target = newUnitZone[action.data.targetIndex]
            if (target) {
              const newDp = target.currentDp - action.data.amount
              if (newDp <= 0) {
                newGraveyard.push({ ...target, currentDp: 0 })
                newUnitZone[action.data.targetIndex] = null
              } else {
                newUnitZone[action.data.targetIndex] = { ...target, currentDp: newDp }
              }
            }
            return { ...prev, unitZone: newUnitZone, graveyard: newGraveyard }
          })
          if (action.data.cardName) {
            showEffectFeedback(`${action.data.cardName}: -${action.data.amount} DP na sua unidade!`, "error")
          }
        }
        break

      case "end_turn":
        // FIX: compute newTurn inside setTurn so we use the correct value for enabling units
        setTurn((prevTurn) => {
          const newTurn = prevTurn + 1
          // Enable my units with the correct (new) turn number
          setMyField((prevField) => ({
            ...prevField,
            unitZone: prevField.unitZone.map((unit) =>
              unit ? { ...unit, canAttack: newTurn > unit.canAttackTurn, hasAttacked: false } : null
            ),
            ultimateZone: prevField.ultimateZone
              ? { ...prevField.ultimateZone, canAttack: prevField.ultimateZone.type !== "ultimateGuardian" && newTurn > prevField.ultimateZone.canAttackTurn, hasAttacked: false }
              : null,
          }))
          return newTurn
        })
        setIsMyTurn(true)
        setPhase("draw")
        break

      case "surrender":
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
      case "ug_ability": {
        const { ability, targetType, targetIndex } = action.data
        if (targetType === "unit" && targetIndex !== undefined) {
          const unit = myFieldRef.current.unitZone[targetIndex]
          if (unit) {
            if (ability === "TWILIGH AVALON") {
              setMyField((prev) => {
                const newUnits = [...prev.unitZone]; newUnits[targetIndex] = null
                return { ...prev, unitZone: newUnits as (FieldCard | null)[], life: Math.max(0, prev.life - 3) }
              })
              showEffectFeedback(`${ability}: ${unit.name} devolvida! -3 LP!`, "error")
            } else if (ability === "KENSEI IFRAID") {
              setMyField((prev) => {
                const newUnits = [...prev.unitZone]; newUnits[targetIndex] = null
                return { ...prev, unitZone: newUnits as (FieldCard | null)[], graveyard: [...prev.graveyard, unit], life: Math.max(0, prev.life - 4) }
              })
              showEffectFeedback(`${ability}: ${unit.name} destruida! -4 LP!`, "error")
            } else if (ability === "VATNAVORDR MESSIHAM") {
              setMyField((prev) => ({ ...prev, life: Math.max(0, prev.life - 2) }))
              showEffectFeedback(`${ability}: ${unit.name} congelada! -2 LP!`, "error")
            } else {
              // MEFISTO FOLES, NIGHTMARE ARMAGEDDON
              setMyField((prev) => {
                const newUnits = [...prev.unitZone]; newUnits[targetIndex] = null
                return { ...prev, unitZone: newUnits as (FieldCard | null)[], graveyard: [...prev.graveyard, unit] }
              })
              showEffectFeedback(`${ability}: ${unit.name} destruida!`, "error")
            }
          }
        } else if (targetType === "function" && targetIndex !== undefined) {
          const func = myFieldRef.current.functionZone[targetIndex]
          if (func) {
            if (ability === "TWILIGH AVALON") {
              setMyField((prev) => {
                const newFuncs = [...prev.functionZone]; newFuncs[targetIndex] = null
                return { ...prev, functionZone: newFuncs }
              })
              showEffectFeedback(`${ability}: ${func.name} devolvida!`, "error")
            } else {
              setMyField((prev) => {
                const newFuncs = [...prev.functionZone]; newFuncs[targetIndex] = null
                return { ...prev, functionZone: newFuncs, graveyard: [...prev.graveyard, func] }
              })
              showEffectFeedback(`${ability}: ${func.name} destruida!`, "error")
            }
          }
        }
        setTimeout(() => checkGameOver(), 0)
        break
      }
    }
  }, [])

  // Keep handleOpponentAction ref in sync
  useEffect(() => {
    handleOpponentActionRef.current = handleOpponentAction
  }, [handleOpponentAction])

  // Check for game over - reads from refs to avoid stale closures
  const checkGameOver = useCallback(() => {
    if (gameResultRecordedRef.current) return

    const myLife = myFieldRef.current.life
    const oppLife = opponentFieldRef.current.life

    if (myLife <= 0) {
      gameResultRecordedRef.current = true
      setGameResult("lost")
      endGame("lost")
    } else if (oppLife <= 0) {
      gameResultRecordedRef.current = true
      setGameResult("won")
      endGame("won")
    }
  }, [])

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
  }, [myField.life, opponentField.life])

  // Global drag event listeners - using refs to avoid stale closures
  const draggedHandCardRef2 = useRef(draggedHandCard)
  const dropTargetRef = useRef(dropTarget)
  const myFieldRef = useRef(myField)
  const opponentFieldRef = useRef(opponentField)
  const isMyTurnRef = useRef(isMyTurn)
  const phaseRef = useRef(phase)
  const turnRef = useRef(turn)
  const sendActionRef = useRef(sendAction)
  const playerIdRef = useRef(playerId)
  const attackStateRef = useRef(attackState)
  const attackTargetRef = useRef(attackTarget)
  const performAttackRef = useRef<(targetType: "direct" | "unit", targetIndex?: number, explicitAttackerIndex?: number, explicitSource?: "unit" | "ultimate") => void>(() => {})
  
  // Keep refs in sync
  useEffect(() => {
    draggedHandCardRef2.current = draggedHandCard
  }, [draggedHandCard])
  
  useEffect(() => {
    dropTargetRef.current = dropTarget
  }, [dropTarget])
  
  useEffect(() => {
    myFieldRef.current = myField
  }, [myField])

  useEffect(() => {
    opponentFieldRef.current = opponentField
  }, [opponentField])
  
  useEffect(() => {
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
    attackStateRef.current = attackState
  }, [attackState])
  
  useEffect(() => {
    attackTargetRef.current = attackTarget
  }, [attackTarget])

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
            // Check if this function card has an activatable effect (centralized registry)
            const effect = getPvPFunctionCardEffect(cardToPlay)
            if (effect) {
              const activationCheck = effect.canActivate({
                playerField: currentField,
                enemyField: opponentFieldRef.current,
                setPlayerField: setMyField,
                setEnemyField: setOpponentField,
              })

              if (!activationCheck.canActivate) {
                showEffectFeedback(`${cardToPlay.name}: ${activationCheck.reason}`, "error")
              } else {
                // Remove from hand first
                setMyField((prev) => ({ ...prev, hand: prev.hand.filter((_, i) => i !== cardIndex) }))

                // For effects needing interaction (choice, dice, target selection), enter itemSelectionMode
                if (effect.requiresChoice && effect.choiceOptions) {
                  setItemSelectionMode({
                    active: true, itemCard: cardToPlay, effect, step: "choice",
                    selectedEnemyIndex: null, selectedAllyIndex: null, chosenOption: null, diceResult: null, handIndex: cardIndex,
                  })
                } else if (effect.requiresDice) {
                  setItemSelectionMode({
                    active: true, itemCard: cardToPlay, effect, step: "dice",
                    selectedEnemyIndex: null, selectedAllyIndex: null, chosenOption: null, diceResult: null, handIndex: cardIndex,
                  })
                } else if (effect.requiresTargets) {
                  const needsEnemy = effect.targetConfig?.enemyUnits && effect.targetConfig.enemyUnits > 0
                  const needsAlly = effect.targetConfig?.allyUnits && effect.targetConfig.allyUnits > 0
                  const hasEnemyUnits = opponentFieldRef.current.unitZone.some((u) => u !== null)

                  if (needsEnemy && hasEnemyUnits) {
                    setItemSelectionMode({
                      active: true, itemCard: cardToPlay, effect, step: "selectEnemy",
                      selectedEnemyIndex: null, selectedAllyIndex: null, chosenOption: null, diceResult: null, handIndex: cardIndex,
                    })
                  } else if (needsAlly) {
                    setItemSelectionMode({
                      active: true, itemCard: cardToPlay, effect, step: "selectAlly",
                      selectedEnemyIndex: null, selectedAllyIndex: null, chosenOption: null, diceResult: null, handIndex: cardIndex,
                    })
                  } else {
                    // Set handIndex in selection mode before resolving so error recovery works
                    setItemSelectionMode((prev) => ({ ...prev, handIndex: cardIndex }))
                    resolveFullEffect(cardToPlay, effect, {})
                  }
                } else {
                  // No targets needed - set handIndex then resolve immediately
                  setItemSelectionMode((prev) => ({ ...prev, handIndex: cardIndex }))
                  resolveFullEffect(cardToPlay, effect, {})
                }
              }
            } else {
              // No registered effect -- place as a passive function card directly
              setMyField((prev) => {
                const newHand = prev.hand.filter((_, i) => i !== cardIndex)
                const newFunctionZone = [...prev.functionZone]
                if (newFunctionZone[targetIndex] !== null) return prev
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

      // Always clear drag state - clear ref immediately to prevent inline handler double-fire
      draggedHandCardRef2.current = null
      dropTargetRef.current = null
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

  // Cache enemy unit positions for fast rect-based hit testing
  const cacheEnemyRects = useCallback(() => {
    const enemyUnitElements = document.querySelectorAll("[data-enemy-unit]")
    enemyUnitRectsRef.current = Array.from(enemyUnitElements).map((el) => el.getBoundingClientRect())
  }, [])

  // Global attack listeners for smooth drag experience (matches bot mode quality)
  useEffect(() => {
    const handleGlobalAttackMove = (e: MouseEvent | TouchEvent) => {
      if (!isDraggingRef.current) return
      const currentAttack = attackStateRef.current
      if (!currentAttack.isAttacking) return

      e.preventDefault()
      const clientX = "touches" in e ? e.touches[0].clientX : (e as MouseEvent).clientX
      const clientY = "touches" in e ? e.touches[0].clientY : (e as MouseEvent).clientY

      positionRef.current.currentX = clientX
      positionRef.current.currentY = clientY

      // Direct state update for immediate arrow response
      setArrowPos((prev) => ({ ...prev, x2: clientX, y2: clientY }))

      // Throttled target detection (50ms) using cached rects
      const now = Date.now()
      if (!positionRef.current.lastTargetCheck || now - positionRef.current.lastTargetCheck > 50) {
        positionRef.current.lastTargetCheck = now

        const fieldRect = fieldRef.current?.getBoundingClientRect()
        if (!fieldRect) return

        const relativeY = clientY - fieldRect.top
        let foundTarget: { type: "direct" | "unit"; index?: number } | null = null

        // Check upper half for enemy units (using cached rects)
        if (relativeY < fieldRect.height / 2) {
          for (let idx = 0; idx < enemyUnitRectsRef.current.length; idx++) {
            const rect = enemyUnitRectsRef.current[idx]
            if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
              if (opponentFieldRef.current.unitZone[idx]) {
                foundTarget = { type: "unit", index: idx }
                break
              }
            }
          }
          // Check for direct attack if no enemy units on field
          if (!foundTarget) {
            const hasEnemyUnits = opponentFieldRef.current.unitZone.some((u) => u !== null)
            if (!hasEnemyUnits) foundTarget = { type: "direct" }
          }
        }

        setAttackTarget(foundTarget)
      }
    }

    // Global end handlers so releasing anywhere resolves the attack
    const handleGlobalAttackEnd = () => {
      if (!isDraggingRef.current) return
      isDraggingRef.current = false

      const currentAttack = attackStateRef.current
      if (currentAttack.isAttacking && currentAttack.attackerIndex !== null) {
        const currentTarget = attackTargetRef.current
        if (currentTarget) {
          performAttackRef.current(currentTarget.type, currentTarget.index, currentAttack.attackerIndex, currentAttack.attackerSource)
        }
      }
      setAttackState({ isAttacking: false, attackerIndex: null, attackerSource: "unit", targetInfo: null })
      setAttackTarget(null)
    }

    window.addEventListener("mousemove", handleGlobalAttackMove, { passive: false })
    window.addEventListener("touchmove", handleGlobalAttackMove, { passive: false })
    window.addEventListener("mouseup", handleGlobalAttackEnd)
    window.addEventListener("touchend", handleGlobalAttackEnd)

    return () => {
      window.removeEventListener("mousemove", handleGlobalAttackMove)
      window.removeEventListener("touchmove", handleGlobalAttackMove)
      window.removeEventListener("mouseup", handleGlobalAttackEnd)
      window.removeEventListener("touchend", handleGlobalAttackEnd)
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

  // Can unit attack now? Guardians can never attack (they have 0 DP and are support-only)
  const canUnitAttackNow = (card: FieldCard): boolean => {
    if (card.type === "ultimateGuardian") return false
    return isMyTurn && phase === "battle" && card.canAttack && !card.hasAttacked && turn > card.canAttackTurn
  }

  // Resolve effect with the centralized system
  const resolveFullEffect = useCallback((
    card: GameCard,
    effect: FunctionCardEffect,
    targets: PvPEffectTargets,
  ) => {
    const context: PvPEffectContext = {
      playerField: myFieldRef.current,
      enemyField: opponentFieldRef.current,
      setPlayerField: setMyField,
      setEnemyField: setOpponentField,
    }
    const result = effect.resolve(context, targets)

    if (result.success) {
      showEffectFeedback(`${card.name}: ${result.message}`, "success")

      // Broadcast damage effects to opponent
      if (result.broadcastDamage) {
        sendActionRef.current({
          type: "damage",
          playerId: playerIdRef.current,
          data: result.broadcastDamage,
          timestamp: Date.now(),
        })
      }

      // Handle draw-after-resolve effects
      if (effect.needsDrawAfterResolve) {
        setMyField((prev) => {
          if (prev.deck.length === 0) return prev
          const drawnCard = prev.deck[0]
          return { ...prev, hand: [...prev.hand, drawnCard], deck: prev.deck.slice(1) }
        })
      }

      // Move card to graveyard
      setMyField((prev) => ({ ...prev, graveyard: [...prev.graveyard, card] }))

      // Broadcast effect activation to opponent
      sendActionRef.current({
        type: "place_card",
        playerId: playerIdRef.current,
        data: { zone: "function", index: -1, card, effect: true },
        timestamp: Date.now(),
      })
    } else {
      showEffectFeedback(`${card.name}: ${result.message}`, "error")
      // Return card to hand on failure
      if (itemSelectionMode.handIndex !== null) {
        setMyField((prev) => {
          const newHand = [...prev.hand]
          newHand.splice(itemSelectionMode.handIndex!, 0, card)
          return { ...prev, hand: newHand }
        })
      }
    }

    // Reset selection mode
    resetItemSelectionMode()
  }, [showEffectFeedback])

  const resetItemSelectionMode = useCallback(() => {
    setItemSelectionMode({ active: false, itemCard: null, effect: null, step: "selectEnemy", selectedEnemyIndex: null, selectedAllyIndex: null, chosenOption: null, diceResult: null, handIndex: null })
  }, [])

  // Handle choice selection (for choice-based effects like Fafnisbani, Veu dos Lacos)
  const handleChoiceSelect = (choiceId: string) => {
    if (!itemSelectionMode.active || itemSelectionMode.step !== "choice") return
    const effect = itemSelectionMode.effect
    if (!effect) return

    setItemSelectionMode((prev) => ({ ...prev, chosenOption: choiceId }))

    // Determine next step based on chosen option and effect config
    const needsEnemyTarget = effect.targetConfig?.enemyUnits && effect.targetConfig.enemyUnits > 0
    const needsAllyTarget = effect.targetConfig?.allyUnits && effect.targetConfig.allyUnits > 0
    const hasEnemyUnits = opponentFieldRef.current.unitZone.some((u) => u !== null)
    const hasAllyUnits = myFieldRef.current.unitZone.some((u) => u !== null)

    // For effects that damage enemies ("unit" option in Fafnisbani/Devorar)
    if (choiceId === "unit" && hasEnemyUnits) {
      setItemSelectionMode((prev) => ({ ...prev, chosenOption: choiceId, step: "selectEnemy" }))
      return
    }
    // For buff effects that target allies ("buff" option in Veu dos Lacos)
    if (choiceId === "buff" && hasAllyUnits) {
      setItemSelectionMode((prev) => ({ ...prev, chosenOption: choiceId, step: "selectAlly" }))
      return
    }
    // For debuff option targeting enemies
    if (choiceId === "debuff" && hasEnemyUnits) {
      setItemSelectionMode((prev) => ({ ...prev, chosenOption: choiceId, step: "selectEnemy" }))
      return
    }

    // If "lp" option or no targets needed, resolve immediately
    if (itemSelectionMode.itemCard && effect) {
      resolveFullEffect(itemSelectionMode.itemCard, effect, { chosenOption: choiceId })
    }
  }

  // Handle dice roll (for dice-based effects)
  const handleDiceRoll = () => {
    if (!itemSelectionMode.active || itemSelectionMode.step !== "dice") return
    const diceResult = Math.floor(Math.random() * 6) + 1
    setItemSelectionMode((prev) => ({ ...prev, diceResult }))

    // After rolling, determine next step
    const effect = itemSelectionMode.effect
    if (!effect) return

    const needsAllyTarget = effect.targetConfig?.allyUnits && effect.targetConfig.allyUnits > 0
    if (needsAllyTarget) {
      setTimeout(() => {
        setItemSelectionMode((prev) => ({ ...prev, step: "selectAlly" }))
      }, 1000) // Show dice result for a moment before proceeding
    } else if (itemSelectionMode.itemCard && effect) {
      setTimeout(() => {
        resolveFullEffect(itemSelectionMode.itemCard!, effect, { diceResult })
      }, 1000)
    }
  }

  // Handle enemy unit selection for item targeting
  const handleEnemyUnitSelect = (index: number) => {
    if (!itemSelectionMode.active || itemSelectionMode.step !== "selectEnemy") return
    if (!opponentFieldRef.current.unitZone[index]) return

    const effect = itemSelectionMode.effect
    const needsAllyTarget = effect?.targetConfig?.allyUnits && effect.targetConfig.allyUnits > 0

    if (needsAllyTarget) {
      setItemSelectionMode((prev) => ({ ...prev, selectedEnemyIndex: index, step: "selectAlly" }))
    } else if (itemSelectionMode.itemCard && effect) {
      // Resolve immediately with just enemy target
      resolveFullEffect(itemSelectionMode.itemCard, effect, {
        enemyUnitIndices: [index],
        chosenOption: itemSelectionMode.chosenOption || undefined,
        diceResult: itemSelectionMode.diceResult || undefined,
      })
    }
  }

  // Handle ally unit selection for item targeting
  const handleAllyUnitSelect = (index: number) => {
    if (!itemSelectionMode.active || itemSelectionMode.step !== "selectAlly") return
    if (!myFieldRef.current.unitZone[index]) return
    if (!itemSelectionMode.itemCard || !itemSelectionMode.effect) return

    resolveFullEffect(itemSelectionMode.itemCard, itemSelectionMode.effect, {
      enemyUnitIndices: itemSelectionMode.selectedEnemyIndex !== null ? [itemSelectionMode.selectedEnemyIndex] : undefined,
      allyUnitIndices: [index],
      chosenOption: itemSelectionMode.chosenOption || undefined,
      diceResult: itemSelectionMode.diceResult || undefined,
    })
  }

  // Cancel item selection
  const cancelItemSelection = () => {
    if (itemSelectionMode.itemCard && itemSelectionMode.handIndex !== null) {
      setMyField((prev) => {
        const newHand = [...prev.hand]
        newHand.splice(itemSelectionMode.handIndex!, 0, itemSelectionMode.itemCard!)
        return { ...prev, hand: newHand }
      })
    }
    resetItemSelectionMode()
  }

  // Check if a card has an activatable effect
  const cardHasEffect = (card: GameCard): boolean => {
    if (card.type === "scenario") return false
    if (isUnitCard(card)) return false
    return getPvPFunctionCardEffect(card) !== null
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
      // ULLRBOGI: +3 DP to required unit when entering battle phase
      if (myField.ultimateZone?.ability === "ULLRBOGI" && myField.ultimateZone.requiresUnit) {
        const ullrName = myField.ultimateZone.requiresUnit
        const ullrIdx = myField.unitZone.findIndex((u) => u && u.name === ullrName)
        if (ullrIdx !== -1) {
          setMyField((prev) => {
            const newUnits = [...prev.unitZone]; const unit = newUnits[ullrIdx]
            if (unit) { newUnits[ullrIdx] = { ...unit, currentDp: unit.currentDp + 3 } }
            return { ...prev, unitZone: newUnits as (FieldCard | null)[] }
          })
          showEffectFeedback(`ULLRBOGI: ${ullrName} +3 DP na fase de batalha!`, "success")
        }
      }
      setPhase("battle")
      // Enable units to attack that were placed in previous turns (not Guardians)
      setMyField((prev) => ({
        ...prev,
        unitZone: prev.unitZone.map((unit) => (unit && turn > unit.canAttackTurn ? { ...unit, canAttack: true } : unit)),
        ultimateZone: prev.ultimateZone && prev.ultimateZone.type !== "ultimateGuardian" && turn > prev.ultimateZone.canAttackTurn
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

  // Place a card - uses refs to avoid stale closure issues when called from global handlers
  const placeCard = (zone: "unit" | "function", index: number, forcedCardIndex?: number) => {
    const cardIndex = forcedCardIndex ?? (draggedHandCard?.index ?? selectedHandCard)
    if (!isMyTurn || phase !== "main" || cardIndex === null) return

    // Read from ref for fresh data (critical when called from global drag-end handlers)
    const currentField = myFieldRef.current
    const card = currentField.hand[cardIndex]
    if (!card) return

    // Check zone compatibility
    if (zone === "unit" && !isUnitCard(card)) return
    if (zone === "function" && isUnitCard(card)) return
    if (card.type === "scenario") return // Scenario cards go to scenario zone only
    if (isUltimateCard(card)) return // Ultimate cards go to ultimate zone only

    // Check if function card has an activatable effect (uses centralized registry)
    if (zone === "function" && cardHasEffect(card)) {
      const effect = getPvPFunctionCardEffect(card)
      if (effect) {
        // Check activation conditions
        const activationCheck = effect.canActivate({
          playerField: myFieldRef.current,
          enemyField: opponentFieldRef.current,
          setPlayerField: setMyField,
          setEnemyField: setOpponentField,
        })
        
        if (!activationCheck.canActivate) {
          showEffectFeedback(`${card.name}: ${activationCheck.reason}`, "error")
          setSelectedHandCard(null)
          return
        }

        // Remove from hand
        setMyField((prev) => ({ ...prev, hand: prev.hand.filter((_, i) => i !== cardIndex) }))

        // Determine the first step based on effect requirements
        if (effect.requiresChoice && effect.choiceOptions) {
          setItemSelectionMode({
            active: true, itemCard: card, effect, step: "choice",
            selectedEnemyIndex: null, selectedAllyIndex: null, chosenOption: null, diceResult: null, handIndex: cardIndex,
          })
        } else if (effect.requiresDice) {
          setItemSelectionMode({
            active: true, itemCard: card, effect, step: "dice",
            selectedEnemyIndex: null, selectedAllyIndex: null, chosenOption: null, diceResult: null, handIndex: cardIndex,
          })
        } else if (effect.requiresTargets) {
          const needsEnemy = effect.targetConfig?.enemyUnits && effect.targetConfig.enemyUnits > 0
          const needsAlly = effect.targetConfig?.allyUnits && effect.targetConfig.allyUnits > 0
          const hasEnemyUnits = opponentFieldRef.current.unitZone.some((u) => u !== null)
          
          if (needsEnemy && hasEnemyUnits) {
            setItemSelectionMode({
              active: true, itemCard: card, effect, step: "selectEnemy",
              selectedEnemyIndex: null, selectedAllyIndex: null, chosenOption: null, diceResult: null, handIndex: cardIndex,
            })
          } else if (needsAlly) {
            setItemSelectionMode({
              active: true, itemCard: card, effect, step: "selectAlly",
              selectedEnemyIndex: null, selectedAllyIndex: null, chosenOption: null, diceResult: null, handIndex: cardIndex,
            })
          } else {
            // No valid targets, resolve immediately
            resolveFullEffect(card, effect, {})
          }
        } else {
          // No targets needed, resolve immediately
          resolveFullEffect(card, effect, {})
        }
        setSelectedHandCard(null)
        return
      }
    }

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

    const currentField = myFieldRef.current
    const card = currentField.hand[cardIndex]
    if (!card || !isUltimateCard(card)) return
    if (currentField.ultimateZone !== null) return

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

    const currentField = myFieldRef.current
    const card = currentField.hand[cardIndex]
    if (!card || card.type !== "scenario") return
    if (currentField.scenarioZone !== null) return // Already has scenario

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
    // Skip if global handler already processed this drop (ref was cleared)
    if (!draggedHandCard || !draggedHandCardRef2.current) {
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

  // Attack handlers - uses isDraggingRef + cached rects for smooth performance (matches bot mode)
  const handleAttackStart = (unitIndex: number, e: React.MouseEvent | React.TouchEvent, source: "unit" | "ultimate" = "unit") => {
    if (!isMyTurn || phase !== "battle") return

    const unit = source === "ultimate" ? myField.ultimateZone : myField.unitZone[unitIndex]
    if (!unit || !canUnitAttackNow(unit)) return

    e.preventDefault()
    e.stopPropagation()

    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY

    isDraggingRef.current = true
    positionRef.current = { startX: clientX, startY: clientY, currentX: clientX, currentY: clientY, lastTargetCheck: 0 }
    cacheEnemyRects()

    setArrowPos({ x1: clientX, y1: clientY, x2: clientX, y2: clientY })
    setAttackState({ isAttacking: true, attackerIndex: unitIndex, attackerSource: source, targetInfo: null })
  }

  // handleAttackMove/End are handled by global listeners.
  // Inline versions kept as no-ops since global listeners handle everything.
  const handleAttackMove = (_e: React.MouseEvent | React.TouchEvent) => {}
  const handleAttackEnd = () => {
    // Global listener handles this - but if it somehow fires inline, clean up
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    if (attackState.isAttacking && attackState.attackerIndex !== null && attackTarget) {
      performAttack(attackTarget.type, attackTarget.index, attackState.attackerIndex, attackState.attackerSource)
    }
    setAttackState({ isAttacking: false, attackerIndex: null, attackerSource: "unit", targetInfo: null })
    setAttackTarget(null)
  }

  // Perform attack - supports both unit zone and ultimate zone attackers
  // Accepts explicit attacker info to avoid stale closure issues
  const performAttack = (targetType: "direct" | "unit", targetIndex?: number, explicitAttackerIndex?: number, explicitSource?: "unit" | "ultimate") => {
    const attackerIdx = explicitAttackerIndex ?? attackStateRef.current.attackerIndex
    const source = explicitSource ?? attackStateRef.current.attackerSource
    if (!isMyTurn || phase !== "battle" || attackerIdx === null) return

    const isUltimateAttacker = source === "ultimate"
    const attacker = isUltimateAttacker ? myFieldRef.current.ultimateZone : myFieldRef.current.unitZone[attackerIdx]
    if (!attacker || !attacker.canAttack || attacker.hasAttacked) return

    const damage = attacker.currentDp

    // Helper to mark the attacker as having attacked
    const markAttackerDone = (counterDamage?: number) => {
      setMyField((prev) => {
        if (isUltimateAttacker && prev.ultimateZone) {
          const newDp = counterDamage !== undefined ? prev.ultimateZone.currentDp - counterDamage : prev.ultimateZone.currentDp
          const updated = { ...prev.ultimateZone, currentDp: newDp, hasAttacked: true, canAttack: false }
          if (newDp <= 0) {
            return { ...prev, ultimateZone: null, graveyard: [...prev.graveyard, { ...updated, currentDp: 0 }] }
          }
          return { ...prev, ultimateZone: updated }
        } else {
          const newUnitZone = [...prev.unitZone]
          const newGraveyard = [...prev.graveyard]
          const unit = newUnitZone[attackerIdx]
          if (unit) {
            const newDp = counterDamage !== undefined ? unit.currentDp - counterDamage : unit.currentDp
            const updated = { ...unit, currentDp: newDp, hasAttacked: true, canAttack: false }
            if (newDp <= 0) {
              newGraveyard.push({ ...updated, currentDp: 0 })
              newUnitZone[attackerIdx] = null
            } else {
              newUnitZone[attackerIdx] = updated
            }
          }
          return { ...prev, unitZone: newUnitZone, graveyard: newGraveyard }
        }
      })
    }

    if (targetType === "direct") {
      // Trigger explosion on direct attack zone
      const directZone = document.querySelector("[data-direct-attack]")
      const directRect = directZone?.getBoundingClientRect()
      if (directRect) triggerExplosion(directRect.left + directRect.width / 2, directRect.top + directRect.height / 2, attacker.element || "neutral")

      setOpponentField((prev) => ({
        ...prev,
        life: Math.max(0, prev.life - damage),
      }))

      sendAction({
        type: "attack",
        playerId,
        data: { attackerIndex: attackerIdx, attackerSource: isUltimateAttacker ? "ultimate" : "unit", targetType: "direct", damage },
        timestamp: Date.now(),
      })

      markAttackerDone()
    } else if (targetType === "unit" && targetIndex !== undefined) {
      const currentTarget = opponentFieldRef.current.unitZone[targetIndex]
      if (!currentTarget) return

      const targetDp = currentTarget.currentDp

      // Trigger explosion on target unit
      const targetEl = document.querySelector(`[data-enemy-unit="${targetIndex}"]`)
      const targetRect = targetEl?.getBoundingClientRect()
      if (targetRect) triggerExplosion(targetRect.left + targetRect.width / 2, targetRect.top + targetRect.height / 2, attacker.element || "neutral")

      // Apply damage to opponent's unit
      setOpponentField((prev) => {
        const newUnitZone = [...prev.unitZone]
        const newGraveyard = [...prev.graveyard]
        const targetUnit = newUnitZone[targetIndex]
        if (targetUnit) {
          const newDp = targetUnit.currentDp - damage
          if (newDp <= 0) {
            newGraveyard.push({ ...targetUnit, currentDp: 0 })
            newUnitZone[targetIndex] = null
          } else {
            newUnitZone[targetIndex] = { ...targetUnit, currentDp: newDp }
          }
        }
        return { ...prev, unitZone: newUnitZone, graveyard: newGraveyard }
      })

      // Attacker takes counter damage
      markAttackerDone(targetDp)

      sendAction({
        type: "attack",
        playerId,
        data: { attackerIndex: attackerIdx, attackerSource: isUltimateAttacker ? "ultimate" : "unit", targetType: "unit", targetIndex, damage, counterDamage: targetDp },
        timestamp: Date.now(),
      })
    }

    // ISGRIMM FENRIR: when equipped Ventus unit attacks, another Ventus unit gets +2 DP
    if (myFieldRef.current.ultimateZone?.ability === "ISGRIMM FENRIR" && attacker.element === "Ventus") {
      setMyField((prev) => {
        const newUnits = [...prev.unitZone]; let buffed = false
        for (let idx = 0; idx < newUnits.length; idx++) {
          const u = newUnits[idx]
          if (u && u.element === "Ventus" && idx !== attackerIdx) { newUnits[idx] = { ...u, currentDp: u.currentDp + 2 }; buffed = true; showEffectFeedback(`ISGRIMM FENRIR: ${u.name} +2 DP!`, "success"); break }
        }
        return buffed ? { ...prev, unitZone: newUnits as (FieldCard | null)[] } : prev
      })
    }

    // Defer game over check so state updates flush first
    setTimeout(() => checkGameOver(), 0)
  }
  // Keep ref in sync for global listeners
  performAttackRef.current = performAttack

  // Activate UG Ability (one-time active effects: ODEN SWORD, TWILIGH AVALON, etc.)
  const activateUgAbility = () => {
    if (!isMyTurn || phase !== "main") return
    if (playerUgAbilityUsed) return
    if (!myField.ultimateZone) return
    const ug = myField.ultimateZone
    const requiredUnit = ug.requiresUnit
    if (!requiredUnit) return
    const unitIdx = myField.unitZone.findIndex((u) => u && u.name === requiredUnit)
    if (unitIdx === -1) { showEffectFeedback(`${requiredUnit} precisa estar no campo!`, "error"); return }

    if (ug.ability === "VATNAVORDR MESSIHAM") {
      const hasEnemyCards = opponentField.unitZone.some((u) => u !== null) || opponentField.functionZone.some((f) => f !== null)
      if (!hasEnemyCards) { showEffectFeedback("Oponente nao tem cartas no campo!", "error"); return }
      setUgTargetMode({ active: true, ugCard: ug, type: "vatnavordr_messiham" })
      setShowUgActivateBtn(false)
      showEffectFeedback("Selecione uma carta do oponente para congelar!", "success")
      return
    }
    if (ug.ability === "YGGDRA NIDHOGG") {
      const hasEnemyFunctions = opponentField.functionZone.some((f) => f !== null)
      if (!hasEnemyFunctions) { showEffectFeedback("Oponente nao tem cartas de Function no campo!", "error"); return }
      setUgTargetMode({ active: true, ugCard: ug, type: "yggdra_nidhogg" })
      setShowUgActivateBtn(false)
      showEffectFeedback("Selecione uma Function inimiga para destruir!", "success")
      return
    }
    if (ug.ability === "ODEN SWORD") {
      const hasEnemyFunctions = opponentField.functionZone.some((f) => f !== null)
      if (!hasEnemyFunctions) { showEffectFeedback("Oponente nao tem cartas de Function!", "error"); return }
      setUgTargetMode({ active: true, ugCard: ug, type: "oden_sword" })
      setShowUgActivateBtn(false)
      showEffectFeedback("Selecione uma Function inimiga para destruir!", "success")
    } else if (ug.ability === "TWILIGH AVALON") {
      const hasEnemyCards = opponentField.unitZone.some((u) => u !== null) || opponentField.functionZone.some((f) => f !== null)
      if (!hasEnemyCards) { showEffectFeedback("Oponente nao tem cartas no campo!", "error"); return }
      setUgTargetMode({ active: true, ugCard: ug, type: "twiligh_avalon" })
      setShowUgActivateBtn(false)
      showEffectFeedback("Selecione uma carta inimiga para devolver a mao!", "success")
    } else if (ug.ability === "KENSEI IFRAID") {
      const hasEnemyCards = opponentField.unitZone.some((u) => u !== null) || opponentField.functionZone.some((f) => f !== null)
      if (!hasEnemyCards) { showEffectFeedback("Oponente nao tem cartas no campo!", "error"); return }
      setUgTargetMode({ active: true, ugCard: ug, type: "kensei_ifraid" })
      setShowUgActivateBtn(false)
      showEffectFeedback("Selecione uma carta do oponente", "success")
    } else if (ug.ability === "MEFISTO FOLES") {
      const hasEnemyCards = opponentField.unitZone.some((u) => u !== null) || opponentField.functionZone.some((f) => f !== null)
      if (!hasEnemyCards) { showEffectFeedback("Oponente nao tem cartas no campo!", "error"); return }
      setUgTargetMode({ active: true, ugCard: ug, type: "mefisto_foles" })
      setShowUgActivateBtn(false)
      showEffectFeedback("Selecione uma carta do oponente", "success")
    } else if (ug.ability === "NIGHTMARE ARMAGEDDON") {
      const hasWeakUnits = opponentField.unitZone.some((u) => u !== null && u.currentDp <= 3)
      if (!hasWeakUnits) { showEffectFeedback("Oponente nao tem unidades com 3 DP ou menos!", "error"); return }
      setUgTargetMode({ active: true, ugCard: ug, type: "nightmare_armageddon" })
      setShowUgActivateBtn(false)
      showEffectFeedback("Selecione uma unidade do oponente (3 DP ou menos)", "success")
    }
  }

  // UG target handlers for active abilities
  const handleUgTargetSelect = (targetType: "unit" | "function", index: number) => {
    if (!ugTargetMode.active) return
    const mode = ugTargetMode.type

    if (mode === "oden_sword") {
      if (targetType !== "function") return
      const func = opponentField.functionZone[index]
      if (!func) return
      setOpponentField((prev) => {
        const newFuncs = [...prev.functionZone]; const destroyed = newFuncs[index]; newFuncs[index] = null
        return { ...prev, functionZone: newFuncs, graveyard: destroyed ? [...prev.graveyard, destroyed] : prev.graveyard }
      })
      showEffectFeedback(`ODEN SWORD: ${func.name} destruida!`, "success")
      sendAction({ type: "ug_ability", playerId, data: { ability: "ODEN SWORD", targetType, targetIndex: index }, timestamp: Date.now() })
    } else if (mode === "twiligh_avalon") {
      if (targetType === "unit") {
        const unit = opponentField.unitZone[index]
        if (!unit) return
        setOpponentField((prev) => {
          const newUnits = [...prev.unitZone]; newUnits[index] = null
          return { ...prev, unitZone: newUnits as (FieldCard | null)[], life: Math.max(0, prev.life - 3) }
        })
        showEffectFeedback(`TWILIGH AVALON: ${unit.name} devolvida! -3 LP!`, "success")
      } else {
        const func = opponentField.functionZone[index]
        if (!func) return
        setOpponentField((prev) => {
          const newFuncs = [...prev.functionZone]; newFuncs[index] = null
          return { ...prev, functionZone: newFuncs }
        })
        showEffectFeedback(`TWILIGH AVALON: ${func.name} devolvida!`, "success")
      }
      sendAction({ type: "ug_ability", playerId, data: { ability: "TWILIGH AVALON", targetType, targetIndex: index }, timestamp: Date.now() })
    } else if (mode === "kensei_ifraid") {
      if (targetType === "unit") {
        const unit = opponentField.unitZone[index]
        if (!unit) return
        setOpponentField((prev) => {
          const newUnits = [...prev.unitZone]; newUnits[index] = null
          return { ...prev, unitZone: newUnits as (FieldCard | null)[], graveyard: unit ? [...prev.graveyard, unit] : prev.graveyard, life: Math.max(0, prev.life - 4) }
        })
        showEffectFeedback(`KENSEI IFRAID: ${unit.name} destruida! -4 LP!`, "success")
      } else {
        const func = opponentField.functionZone[index]
        if (!func) return
        setOpponentField((prev) => {
          const newFuncs = [...prev.functionZone]; newFuncs[index] = null
          return { ...prev, functionZone: newFuncs, graveyard: func ? [...prev.graveyard, func] : prev.graveyard }
        })
        showEffectFeedback(`KENSEI IFRAID: ${func.name} destruida!`, "success")
      }
      sendAction({ type: "ug_ability", playerId, data: { ability: "KENSEI IFRAID", targetType, targetIndex: index }, timestamp: Date.now() })
    } else if (mode === "mefisto_foles") {
      if (targetType === "unit") {
        const unit = opponentField.unitZone[index]
        if (!unit) return
        setOpponentField((prev) => {
          const newUnits = [...prev.unitZone]; newUnits[index] = null
          return { ...prev, unitZone: newUnits as (FieldCard | null)[], graveyard: unit ? [...prev.graveyard, unit] : prev.graveyard }
        })
        showEffectFeedback(`MEFISTO FOLES: ${unit.name} destruida!`, "success")
      } else {
        const func = opponentField.functionZone[index]
        if (!func) return
        setOpponentField((prev) => {
          const newFuncs = [...prev.functionZone]; newFuncs[index] = null
          return { ...prev, functionZone: newFuncs, graveyard: func ? [...prev.graveyard, func] : prev.graveyard }
        })
        showEffectFeedback(`MEFISTO FOLES: ${func.name} destruida!`, "success")
      }
      sendAction({ type: "ug_ability", playerId, data: { ability: "MEFISTO FOLES", targetType, targetIndex: index }, timestamp: Date.now() })
    } else if (mode === "nightmare_armageddon") {
      if (targetType !== "unit") return
      const unit = opponentField.unitZone[index]
      if (!unit || unit.currentDp > 3) { showEffectFeedback("Unidade deve ter 3 DP ou menos!", "error"); return }
      setOpponentField((prev) => {
        const newUnits = [...prev.unitZone]; newUnits[index] = null
        return { ...prev, unitZone: newUnits as (FieldCard | null)[], graveyard: unit ? [...prev.graveyard, unit] : prev.graveyard }
      })
      showEffectFeedback(`NIGHTMARE ARMAGEDDON: ${unit.name} destruida!`, "success")
      sendAction({ type: "ug_ability", playerId, data: { ability: "NIGHTMARE ARMAGEDDON", targetType, targetIndex: index }, timestamp: Date.now() })
    } else if (mode === "vatnavordr_messiham") {
      if (targetType === "unit") {
        const unit = opponentField.unitZone[index]
        if (!unit) return
        setOpponentField((prev) => ({ ...prev, life: Math.max(0, prev.life - 2) }))
        showEffectFeedback(`VATNAVORDR MESSIHAM: ${unit.name} congelada! -2 LP!`, "success")
      } else {
        const func = opponentField.functionZone[index]
        if (!func) return
        showEffectFeedback(`VATNAVORDR MESSIHAM: ${func.name} congelada!`, "success")
      }
      sendAction({ type: "ug_ability", playerId, data: { ability: "VATNAVORDR MESSIHAM", targetType, targetIndex: index }, timestamp: Date.now() })
    } else if (mode === "yggdra_nidhogg") {
      if (targetType !== "function") return
      const func = opponentField.functionZone[index]
      if (!func) return
      setOpponentField((prev) => {
        const newFuncs = [...prev.functionZone]; newFuncs[index] = null
        return { ...prev, functionZone: newFuncs, graveyard: func ? [...prev.graveyard, func] : prev.graveyard }
      })
      showEffectFeedback(`YGGDRA NIDHOGG: ${func.name} destruida!`, "success")
      sendAction({ type: "ug_ability", playerId, data: { ability: "YGGDRA NIDHOGG", targetType, targetIndex: index }, timestamp: Date.now() })
    }
    setPlayerUgAbilityUsed(true)
    setUgTargetMode({ active: false, ugCard: null, type: null })
  }

  const cancelUgTargetMode = () => setUgTargetMode({ active: false, ugCard: null, type: null })

  // Check if UG has an activatable ability
  const hasActivatableUgAbility = (): boolean => {
    if (!myField.ultimateZone || playerUgAbilityUsed) return false
    const activatable = ["ODEN SWORD", "TWILIGH AVALON", "KENSEI IFRAID", "MEFISTO FOLES", "NIGHTMARE ARMAGEDDON", "VATNAVORDR MESSIHAM", "YGGDRA NIDHOGG"]
    return activatable.includes(myField.ultimateZone.ability || "")
  }

  // End turn
  const endTurn = () => {
    if (!isMyTurn) return

    // ULLRBOGI: remove +3 DP when leaving battle phase
    if (myField.ultimateZone?.ability === "ULLRBOGI" && myField.ultimateZone.requiresUnit) {
      const ullrName = myField.ultimateZone.requiresUnit
      const ullrIdx = myField.unitZone.findIndex((u) => u && u.name === ullrName)
      if (ullrIdx !== -1) {
        setMyField((prev) => {
          const newUnits = [...prev.unitZone]; const unit = newUnits[ullrIdx]
          if (unit) { newUnits[ullrIdx] = { ...unit, currentDp: Math.max(0, unit.currentDp - 3) } }
          return { ...prev, unitZone: newUnits as (FieldCard | null)[] }
        })
      }
    }

    setIsMyTurn(false)
    setPhase("end")
    setSelectedHandCard(null)

    // Disable my units (immutable)
    setMyField((prev) => ({
      ...prev,
      unitZone: prev.unitZone.map((unit) => (unit ? { ...unit, canAttack: false, hasAttacked: false } : null)),
      ultimateZone: prev.ultimateZone ? { ...prev.ultimateZone, canAttack: false, hasAttacked: false } : null,
    }))

    // Enable opponent's units (immutable) - Guardians cannot attack
    setOpponentField((prev) => ({
      ...prev,
      unitZone: prev.unitZone.map((unit) => (unit ? { ...unit, canAttack: true, hasAttacked: false } : null)),
      ultimateZone: prev.ultimateZone
        ? { ...prev.ultimateZone, canAttack: prev.ultimateZone.type !== "ultimateGuardian", hasAttacked: false }
        : null,
    }))

    sendAction({
      type: "end_turn",
      playerId,
      data: { turn: turnRef.current },
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

  // Get playmat for player's own deck (uses local player's context correctly)
  const myPlaymat = myDeck ? getPlaymatForDeck(myDeck) : null
  // For opponent's playmat: use the playmatImage embedded in their serialized deck if available,
  // otherwise try getPlaymatForDeck as fallback (won't work if the opponent has playmats the local player doesn't own)
  const opponentPlaymat = opponentDeck
    ? (opponentDeck as any).playmatImage
      ? { name: "Opponent Playmat", image: (opponentDeck as any).playmatImage }
      : getPlaymatForDeck(opponentDeck)
    : null

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

      {/* Explosion Canvas */}
      <canvas
        ref={explosionCanvasRef}
        className="fixed inset-0 pointer-events-none z-[60]"
        style={{ width: "100vw", height: "100vh" }}
      />

      {/* Impact Flash Overlay */}
      {impactFlash.active && (
        <div className="fixed inset-0 pointer-events-none z-[59] transition-opacity duration-200" style={{ backgroundColor: impactFlash.color }} />
      )}

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
                      data-enemy-func={i}
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
                className={`px-6 py-1.5 rounded-full border-2 border-dashed transition-all text-sm font-bold ${
                  attackTarget?.type === "direct"
                    ? "border-red-500 bg-red-500/30 text-red-300 scale-105 animate-pulse"
                    : attackState.isAttacking && !opponentField.unitZone.some((u) => u !== null)
                      ? "border-red-500/60 bg-red-500/10 text-red-400/80"
                      : "border-slate-500/50 text-slate-500"
                }`}
              >
                {attackTarget?.type === "direct" 
                  ? "ATAQUE DIRETO!" 
                  : attackState.isAttacking && !opponentField.unitZone.some((u) => u !== null)
                    ? "ATAQUE DIRETO"
                    : ""}
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
                  {/* Player Ultimate Zone */}
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
                    const canUltimateAttack = myField.ultimateZone && canUnitAttackNow(myField.ultimateZone)

                    return (
                      <div className="flex flex-col items-center">
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
                              : canUltimateAttack
                                ? "border-yellow-400 shadow-lg shadow-yellow-500/40"
                                : "border-emerald-600/40"
                        }`}
                      >
                        {canUltimateAttack && (
                          <div className="absolute -inset-1 bg-yellow-400/40 rounded blur-sm animate-pulse -z-10" />
                        )}
                        {myField.ultimateZone ? (
                          <>
                            <Image
                              src={myField.ultimateZone.image || "/placeholder.svg"}
                              alt={myField.ultimateZone.name}
                              fill
                              className="object-cover rounded"
                              onMouseDown={(e) => {
                                if (canUltimateAttack) {
                                  handleAttackStart(0, e, "ultimate")
                                } else {
                                  handleCardPressStart(myField.ultimateZone!)
                                }
                              }}
                              onMouseUp={handleCardPressEnd}
                              onMouseLeave={handleCardPressEnd}
                              onTouchStart={(e) => {
                                if (canUltimateAttack) {
                                  handleAttackStart(0, e, "ultimate")
                                } else {
                                  handleCardPressStart(myField.ultimateZone!)
                                }
                              }}
                              onTouchEnd={handleCardPressEnd}
                            />
                            {canUltimateAttack && (
                              <div className="absolute top-0 left-0 right-0 bg-green-500 text-white text-[10px] text-center font-bold animate-pulse">
                                {t("dragToAttack")}
                              </div>
                            )}
                            {myField.ultimateZone.type === "ultimateGuardian" && (
                              <div className="absolute top-0 left-0 right-0 bg-blue-600/90 text-white text-[8px] text-center font-bold">
                                GUARDIAN
                              </div>
                            )}
                            <div className="absolute bottom-0 left-0 right-0 bg-black/80 text-center text-xs text-white font-bold py-0.5">
                              {myField.ultimateZone.type === "ultimateGuardian" ? (
                                <span className="text-blue-300">{myField.ultimateZone.ability || "GUARD"}</span>
                              ) : (
                                <>{myField.ultimateZone.currentDp} DP</>
                              )}
                            </div>
                          </>
                        ) : null}
                        {!myField.ultimateZone && isDroppingUltimate && (
                          <span className="text-green-400 text-[10px] font-bold animate-pulse">SOLTAR</span>
                        )}
                      </div>
                      {/* UG Activate Ability Button */}
                      {myField.ultimateZone && hasActivatableUgAbility() && isMyTurn && phase === "main" && (
                        <button
                          onClick={(e) => { e.stopPropagation(); activateUgAbility() }}
                          className="w-14 mt-0.5 px-1 py-0.5 bg-amber-600/90 hover:bg-amber-500 text-white text-[8px] font-bold rounded transition-colors animate-pulse border border-amber-400/60"
                        >
                          ATIVAR
                        </button>
                      )}
                      </div>
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
              <div className="text-xl font-bold text-blue-400" data-player-life>LP: {myField.life}</div>
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
  
  {/* Effect Feedback Toast */}
  {effectFeedback && (
    <div className={`fixed top-1/3 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-xl text-white font-bold text-lg shadow-2xl animate-pulse ${
      effectFeedback.type === "success"
        ? "bg-gradient-to-r from-green-600 to-emerald-600 border-2 border-green-400"
        : "bg-gradient-to-r from-red-600 to-rose-600 border-2 border-red-400"
    }`}>
      {effectFeedback.message}
    </div>
  )}

  {/* Item Selection Mode Overlay */}
  {itemSelectionMode.active && (
    <div className="fixed inset-0 z-[80] pointer-events-none">
      {/* Dim overlay */}
      <div className="absolute inset-0 bg-black/50 pointer-events-auto" onClick={cancelItemSelection} />
      
      {/* Instruction banner */}
      <div className="absolute top-20 left-1/2 -translate-x-1/2 z-10 pointer-events-auto" style={{ maxWidth: "90vw" }}>
        <div className="bg-gradient-to-r from-amber-600 to-amber-700 px-6 py-3 rounded-xl border-2 border-amber-400 shadow-2xl">
          <p className="text-white font-bold text-center text-sm">
            {itemSelectionMode.step === "choice"
              ? "Escolha uma opcao"
              : itemSelectionMode.step === "dice"
                ? itemSelectionMode.diceResult
                  ? `Resultado: ${itemSelectionMode.diceResult}!`
                  : "Toque para rolar o dado"
                : itemSelectionMode.step === "selectEnemy"
                  ? "Selecione uma unidade INIMIGA como alvo"
                  : "Selecione uma unidade ALIADA para receber o efeito"}
          </p>
          <p className="text-amber-200 text-xs text-center mt-1">
            {itemSelectionMode.itemCard?.name} | Toque fora para cancelar
          </p>
        </div>
      </div>

      {/* Choice options UI */}
      {itemSelectionMode.step === "choice" && itemSelectionMode.effect?.choiceOptions && (
        <div className="absolute top-36 left-1/2 -translate-x-1/2 z-10 pointer-events-auto flex flex-col gap-2" style={{ maxWidth: "90vw" }}>
          {itemSelectionMode.effect.choiceOptions.map((option) => (
            <button
              key={option.id}
              onClick={() => handleChoiceSelect(option.id)}
              className="bg-gradient-to-r from-slate-700 to-slate-600 hover:from-amber-600 hover:to-amber-500 text-white px-6 py-3 rounded-xl border-2 border-slate-500 hover:border-amber-400 transition-all shadow-xl"
            >
              <div className="font-bold text-sm">{option.label}</div>
              <div className="text-slate-300 text-xs mt-0.5">{option.description}</div>
            </button>
          ))}
        </div>
      )}

      {/* Dice roll UI */}
      {itemSelectionMode.step === "dice" && (
        <div className="absolute top-36 left-1/2 -translate-x-1/2 z-10 pointer-events-auto flex flex-col items-center gap-3">
          {!itemSelectionMode.diceResult ? (
            <button
              onClick={handleDiceRoll}
              className="w-24 h-24 bg-gradient-to-br from-amber-500 to-amber-700 rounded-2xl border-4 border-amber-300 shadow-2xl flex items-center justify-center text-4xl font-bold text-white hover:scale-110 transition-transform animate-pulse"
            >
              {'?'}
            </button>
          ) : (
            <div className="w-24 h-24 bg-gradient-to-br from-amber-500 to-amber-700 rounded-2xl border-4 border-amber-300 shadow-2xl flex items-center justify-center text-5xl font-bold text-white">
              {itemSelectionMode.diceResult}
            </div>
          )}
        </div>
      )}

      {/* Highlight targetable enemy units */}
      {itemSelectionMode.step === "selectEnemy" && opponentField.unitZone.map((card, i) => {
        if (!card) return null
        const el = document.querySelector(`[data-enemy-unit="${i}"]`)
        if (!el) return null
        const rect = el.getBoundingClientRect()
        return (
          <div
            key={`enemy-target-${i}`}
            className="absolute pointer-events-auto cursor-pointer border-4 border-red-500 rounded bg-red-500/30 animate-pulse z-20"
            style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }}
            onClick={() => handleEnemyUnitSelect(i)}
          />
        )
      })}
      
      {/* UG Target Mode: Highlight enemy cards for ability activation */}
      {ugTargetMode.active && (
        <>
          {/* Cancel button */}
          <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[70]">
            <button onClick={cancelUgTargetMode} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-bold rounded-lg border border-red-400/50 shadow-lg">
              Cancelar
            </button>
          </div>
          {/* Enemy units */}
          {opponentField.unitZone.map((card, i) => {
            if (!card) return null
            // NIGHTMARE: only units with 3 DP or less
            if (ugTargetMode.type === "nightmare_armageddon" && card.currentDp > 3) return null
            // ODEN SWORD / YGGDRA NIDHOGG: only function cards (skip units)
            if (ugTargetMode.type === "oden_sword" || ugTargetMode.type === "yggdra_nidhogg") return null
            const el = document.querySelector(`[data-enemy-unit="${i}"]`)
            if (!el) return null
            const rect = el.getBoundingClientRect()
            return (
              <div key={`ug-enemy-unit-${i}`}
                className="absolute pointer-events-auto cursor-pointer border-4 border-amber-500 rounded bg-amber-500/30 animate-pulse z-[65]"
                style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }}
                onClick={() => handleUgTargetSelect("unit", i)}
              />
            )
          })}
          {/* Enemy function cards */}
          {opponentField.functionZone.map((card, i) => {
            if (!card) return null
            // NIGHTMARE: only targets units
            if (ugTargetMode.type === "nightmare_armageddon") return null
            const el = document.querySelector(`[data-enemy-func="${i}"]`)
            if (!el) return null
            const rect = el.getBoundingClientRect()
            return (
              <div key={`ug-enemy-func-${i}`}
                className="absolute pointer-events-auto cursor-pointer border-4 border-amber-500 rounded bg-amber-500/30 animate-pulse z-[65]"
                style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }}
                onClick={() => handleUgTargetSelect("function", i)}
              />
            )
          })}
        </>
      )}

      {/* Highlight targetable ally units */}
      {itemSelectionMode.step === "selectAlly" && myField.unitZone.map((card, i) => {
        if (!card) return null
        const el = document.querySelector(`[data-player-unit-slot="${i}"]`)
        if (!el) return null
        const rect = el.getBoundingClientRect()
        return (
          <div
            key={`ally-target-${i}`}
            className="absolute pointer-events-auto cursor-pointer border-4 border-green-500 rounded bg-green-500/30 animate-pulse z-20"
            style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }}
            onClick={() => handleAllyUnitSelect(i)}
          />
        )
      })}
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
    
    {/* Card name - appears at peak with glow effect */}
    <div className="draw-card-name">
      <span className="text-cyan-300 font-bold text-base md:text-lg drop-shadow-[0_0_8px_rgba(56,189,248,0.8)]">
        {drawAnimation.cardName}
      </span>
    </div>
  </div>
  )}
  
  {/* Card Inspection Overlay - Press and hold to view */}
  {inspectedCard && (
  <div 
    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90"
    onClick={() => setInspectedCard(null)}
    onTouchEnd={() => setInspectedCard(null)}
  >
    <div 
      className="relative"
      style={{ animation: 'cardInspectIn 250ms ease-out forwards' }}
    >
      {/* Large glow effects */}
      <div className="absolute -inset-20 bg-gradient-to-br from-cyan-500/15 to-purple-500/15 blur-3xl rounded-full" />
      <div className="absolute -inset-12 bg-gradient-to-br from-cyan-400/20 to-purple-400/20 blur-2xl rounded-3xl" />
      <div className="absolute -inset-4 bg-white/5 blur-xl rounded-2xl" />
      {/* Card - Much larger */}
      <div className="relative rounded-3xl border-4 border-white/40 shadow-2xl overflow-hidden bg-slate-900"
           style={{ width: '280px', height: '392px' }}>
        <img
          src={inspectedCard.image || "/placeholder.svg"}
          alt={inspectedCard.name}
          className="w-full h-full object-contain"
        />
        {/* Shine overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-transparent pointer-events-none" />
      </div>
      {/* Card info */}
      <div className="absolute -bottom-20 left-1/2 -translate-x-1/2 text-center w-80">
        <div className="text-white font-bold text-2xl drop-shadow-lg">{inspectedCard.name}</div>
        {isUnitCard(inspectedCard) && (
          <div className="flex flex-col items-center gap-1 mt-2">
            <div className={`text-xl font-semibold ${
              (inspectedCard as FieldCard).currentDp !== undefined && (inspectedCard as FieldCard).currentDp > inspectedCard.dp 
                ? "text-green-400" 
                : (inspectedCard as FieldCard).currentDp !== undefined && (inspectedCard as FieldCard).currentDp < inspectedCard.dp 
                  ? "text-red-400" 
                  : "text-cyan-400"
            }`}>
              {(inspectedCard as FieldCard).currentDp !== undefined ? (inspectedCard as FieldCard).currentDp : inspectedCard.dp} DP
            </div>
            {(inspectedCard as FieldCard).currentDp !== undefined && (inspectedCard as FieldCard).currentDp !== inspectedCard.dp && (
              <div className="text-white/50 text-sm">
                {'('}Base: {inspectedCard.dp} DP | {(inspectedCard as FieldCard).currentDp > inspectedCard.dp ? "+" : ""}{(inspectedCard as FieldCard).currentDp - inspectedCard.dp}{')'}
              </div>
            )}
          </div>
        )}
        {!isUnitCard(inspectedCard) && (
          <div className="text-purple-400 text-lg mt-2 font-semibold">Carta de Funcao</div>
        )}
      </div>
      {/* Close hint */}
      <div className="absolute -top-10 left-1/2 -translate-x-1/2 text-white/50 text-sm">
        Toque para fechar
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
