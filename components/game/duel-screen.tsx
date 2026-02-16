"use client"

import type React from "react"
import type { Deck as GameDeck, Card as GameCard } from "@/contexts/game-context"

import { useState, useEffect, useRef, useCallback } from "react"
import { useLanguage } from "@/contexts/language-context"
// REMOVED: import { useGame, type Deck as GameDeck, type Card as GameCard } from "@/contexts/game-context"
import { useGame } from "@/contexts/game-context"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Swords } from "lucide-react"
import Image from "next/image"
import { MultiplayerLobby } from "./multiplayer-lobby"
import { OnlineDuelScreen } from "./online-duel-screen"

interface DuelScreenProps {
  mode: "bot" | "player"
  onBack: () => void
}

interface RoomData {
  roomId: string
  roomCode: string
  isHost: boolean
  hostId: string
  hostName: string
  hostDeck: GameDeck | null
  guestId: string | null
  guestName: string | null
  guestDeck: GameDeck | null
  hostReady: boolean
  guestReady: boolean
}

type Phase = "draw" | "main" | "battle" | "end"

interface FieldCard extends GameCard {
  currentDp: number
  canAttack: boolean
  hasAttacked: boolean
  canAttackTurn: number // Made required, not optional
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

interface AttackState {
  isAttacking: boolean
  attackerIndex: number | null
  targetInfo?: { type: "unit" | "direct"; index?: number } | null
}

interface DropTarget {
  type: "unit" | "function" | "scenario" | "ultimate"
  index: number
}

interface ExplosionEffect {
  id: string
  x: number
  y: number
  element: string
  particles: Particle[]
  startTime: number
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  alpha: number
  color: string
}

// Define interface for Deck with image and playmat image
interface DeckWithImages extends GameDeck {
  image?: string
  playmatImage?: string
}

// ==========================================
// CENTRALIZED FUNCTION CARD EFFECT SYSTEM
// ==========================================

interface FunctionCardEffect {
  id: string
  name: string
  requiresTargets: boolean
  requiresChoice?: boolean
  requiresDice?: boolean // For dice-rolling effects
  choiceOptions?: { id: string; label: string; description: string }[]
  targetConfig?: {
  enemyUnits?: number // Number of enemy units to select
  allyUnits?: number // Number of ally units to select
  }
  canActivate: (context: EffectContext) => { canActivate: boolean; reason?: string }
  resolve: (context: EffectContext, targets?: EffectTargets) => EffectResult
}

interface EffectContext {
  playerField: FieldState
  enemyField: FieldState
  setPlayerField: React.Dispatch<React.SetStateAction<FieldState>>
  setEnemyField: React.Dispatch<React.SetStateAction<FieldState>>
}

interface EffectTargets {
  enemyUnitIndices?: number[]
  allyUnitIndices?: number[]
  chosenOption?: string
  diceResult?: number // Result of dice roll (1-6)
}

interface EffectResult {
  success: boolean
  message?: string
  cardToDiscard?: GameCard
}

// Registry of all Function card effects
const FUNCTION_CARD_EFFECTS: Record<string, FunctionCardEffect> = {
  "amplificador-de-poder": {
    id: "amplificador-de-poder",
    name: "Amplificador de Poder",
    requiresTargets: true,
    targetConfig: {
      enemyUnits: 1,
      allyUnits: 1,
    },
    canActivate: (context) => {
      const hasEnemyUnits = context.enemyField.unitZone.some((u) => u !== null)
      const hasPlayerUnits = context.playerField.unitZone.some((u) => u !== null)
      
      if (!hasEnemyUnits) {
        return { canActivate: false, reason: "Nenhuma unidade inimiga no campo" }
      }
      if (!hasPlayerUnits) {
        return { canActivate: false, reason: "Nenhuma unidade aliada no campo" }
      }
      return { canActivate: true }
    },
    resolve: (context, targets) => {
      if (!targets?.enemyUnitIndices?.length || !targets?.allyUnitIndices?.length) {
        return { success: false, message: "Alvos invalidos" }
      }
      
      const enemyIndex = targets.enemyUnitIndices[0]
      const allyIndex = targets.allyUnitIndices[0]
      const enemyUnit = context.enemyField.unitZone[enemyIndex]
      const allyUnit = context.playerField.unitZone[allyIndex]
      
      if (!enemyUnit || !allyUnit) {
        return { success: false, message: "Unidades nao encontradas" }
      }
      
      // Get ORIGINAL DP (base dp, not currentDp which may have buffs/debuffs)
      const dpBonus = enemyUnit.dp
      const allyCurrentDp = allyUnit.currentDp || allyUnit.dp
      const newDp = allyCurrentDp + dpBonus
      
      context.setPlayerField((prev) => {
        const newUnitZone = [...prev.unitZone]
        if (newUnitZone[allyIndex]) {
          newUnitZone[allyIndex] = {
            ...newUnitZone[allyIndex]!,
            currentDp: newDp,
          }
        }
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
      const currentLife = context.playerField.life
      const maxLife = 20 // Max LP
      
      if (currentLife >= maxLife) {
        return { canActivate: false, reason: "LP ja esta no maximo" }
      }
      return { canActivate: true }
    },
    resolve: (context) => {
      const currentLife = context.playerField.life
      const maxLife = 20
      const healAmount = Math.min(2, maxLife - currentLife) // Heal up to 2, but don't exceed max
      
      if (healAmount <= 0) {
        return { success: false, message: "Nao ha dano para curar" }
      }
      
      const newLife = Math.min(currentLife + healAmount, maxLife)
      
      context.setPlayerField((prev) => ({
        ...prev,
        life: newLife,
      }))
      
      return { success: true, message: `+${healAmount} LP restaurado! (${currentLife} -> ${newLife})` }
    },
  },
  
  "adaga-energizada": {
    id: "adaga-energizada",
    name: "Adaga Energizada",
    requiresTargets: false,
    canActivate: (context) => {
      // Count enemy units on the field
      const enemyUnitCount = context.enemyField.unitZone.filter((u) => u !== null).length
      
      if (enemyUnitCount < 2) {
        return { canActivate: false, reason: "O oponente precisa ter 2 ou mais unidades no campo" }
      }
      return { canActivate: true }
    },
    resolve: (context) => {
      // Deal 4 direct damage to enemy LP
      const damage = 4
      const currentEnemyLife = context.enemyField.life
      const newEnemyLife = Math.max(0, currentEnemyLife - damage)
      
      context.setEnemyField((prev) => ({
        ...prev,
        life: newEnemyLife,
      }))
      
      return { success: true, message: `4 de dano direto! LP do oponente: ${currentEnemyLife} -> ${newEnemyLife}` }
    },
  },
  
  "bandagens-duplas": {
    id: "bandagens-duplas",
    name: "Bandagens Duplas",
    requiresTargets: false,
    canActivate: (context) => {
      const currentLife = context.playerField.life
      const maxLife = 20 // Max LP
      
      if (currentLife >= maxLife) {
        return { canActivate: false, reason: "LP ja esta no maximo" }
      }
      return { canActivate: true }
    },
    resolve: (context) => {
      const currentLife = context.playerField.life
      const maxLife = 20
      const healAmount = Math.min(4, maxLife - currentLife) // Heal up to 4, but don't exceed max
      
      if (healAmount <= 0) {
        return { success: false, message: "Nao ha dano para curar" }
      }
      
      const newLife = Math.min(currentLife + healAmount, maxLife)
      
      context.setPlayerField((prev) => ({
        ...prev,
        life: newLife,
      }))
      
      return { success: true, message: `+${healAmount} LP restaurado! (${currentLife} -> ${newLife})` }
    },
  },
  
  "cristal-recuperador": {
    id: "cristal-recuperador",
    name: "Cristal Recuperador",
    requiresTargets: false,
    // This effect needs special handling because it draws a card
    // We'll mark it as needing post-resolution draw
    needsDrawAfterResolve: true,
    canActivate: (context) => {
      const currentLife = context.playerField.life
      const maxLife = 20
      
      if (currentLife >= maxLife) {
        return { canActivate: false, reason: "LP ja esta no maximo" }
      }
      return { canActivate: true }
    },
    resolve: (context) => {
      const currentLife = context.playerField.life
      const maxLife = 20
      const healAmount = Math.min(3, maxLife - currentLife)
      const newLife = Math.min(currentLife + healAmount, maxLife)
      
      context.setPlayerField((prev) => ({
        ...prev,
        life: newLife,
      }))
      
      // Return special flag to indicate we need to draw and potentially heal more
      return { 
        success: true, 
        message: `+${healAmount} LP restaurado! (${currentLife} -> ${newLife})`,
        needsDrawAndCheck: true,
        currentLife: newLife,
      }
    },
  },
  
  "cauda-de-dragao-assada": {
    id: "cauda-de-dragao-assada",
    name: "Cauda de Dragão Assada",
    requiresTargets: false,
    canActivate: (context) => {
      // Count player units on the field
      const playerUnitCount = context.playerField.unitZone.filter((u) => u !== null).length
      
      if (playerUnitCount < 2) {
        return { canActivate: false, reason: "Voce precisa ter 2 ou mais unidades no campo" }
      }
      return { canActivate: true }
    },
    resolve: (context) => {
      const maxLife = 20
      const currentLife = context.playerField.life
      const healAmount = Math.min(2, maxLife - currentLife)
      const newLife = Math.min(currentLife + healAmount, maxLife)
      
      // Buff all player units with +1 DP
      context.setPlayerField((prev) => ({
        ...prev,
        life: newLife,
        unitZone: prev.unitZone.map((unit) => {
          if (unit === null) return null
          return {
            ...unit,
            currentDp: (unit.currentDp || unit.dp) + 1,
          }
        }),
      }))
      
      const unitCount = context.playerField.unitZone.filter((u) => u !== null).length
      const healMsg = healAmount > 0 ? ` +${healAmount} LP (${currentLife} -> ${newLife})` : ""
      return { success: true, message: `+1 DP para ${unitCount} unidades!${healMsg}` }
    },
  },
  
  "projetil-de-impacto": {
    id: "projetil-de-impacto",
    name: "Projétil de Impacto",
    requiresTargets: false,
    canActivate: () => {
      // No condition - can always be activated
      return { canActivate: true }
    },
    resolve: (context) => {
      // Deal 2 direct damage to enemy LP
      const damage = 2
      const currentEnemyLife = context.enemyField.life
      const newEnemyLife = Math.max(0, currentEnemyLife - damage)
      
      context.setEnemyField((prev) => ({
        ...prev,
        life: newEnemyLife,
      }))
      
      return { success: true, message: `2 de dano direto! LP do oponente: ${currentEnemyLife} -> ${newEnemyLife}` }
    },
  },
  
  "veu-dos-lacos-cruzados": {
    id: "veu-dos-lacos-cruzados",
    name: "Véu dos Laços Cruzados",
    requiresTargets: true,
    requiresChoice: true, // Requires player to choose between two options
    choiceOptions: [
      { id: "buff", label: "+2 DP em Fehnon/Jaden", description: "Adiciona 2 DP a uma unidade Fehnon Hoskie ou Jaden Hainaegi sua" },
      { id: "debuff", label: "-2 DP em inimigo", description: "Reduz 2 DP de uma unidade do oponente" },
    ],
    targetConfig: {
      allyUnits: 1,
    },
    canActivate: (context) => {
      // Check if player has Fehnon Hoskie or Jaden Hainaegi on field
      const hasRequiredUnit = context.playerField.unitZone.some((u) => 
        u !== null && (u.name === "Fehnon Hoskie" || u.name === "Jaden Hainaegi")
      )
      
      if (!hasRequiredUnit) {
        return { canActivate: false, reason: "Voce precisa ter Fehnon Hoskie ou Jaden Hainaegi no campo" }
      }
      return { canActivate: true }
    },
    resolve: (context, targets) => {
      const chosenOption = targets?.chosenOption
      
      if (chosenOption === "buff") {
        // Buff option: +2 DP to Fehnon or Jaden
        if (!targets?.allyUnitIndices?.length) {
          return { success: false, message: "Selecione uma unidade Fehnon ou Jaden" }
        }
        
        const allyIndex = targets.allyUnitIndices[0]
        const allyUnit = context.playerField.unitZone[allyIndex]
        
        if (!allyUnit || (allyUnit.name !== "Fehnon Hoskie" && allyUnit.name !== "Jaden Hainaegi")) {
          return { success: false, message: "Selecione Fehnon Hoskie ou Jaden Hainaegi" }
        }
        
        const currentDp = allyUnit.currentDp || allyUnit.dp
        const newDp = currentDp + 2
        
        context.setPlayerField((prev) => {
          const newUnitZone = [...prev.unitZone]
          if (newUnitZone[allyIndex]) {
            newUnitZone[allyIndex] = {
              ...newUnitZone[allyIndex]!,
              currentDp: newDp,
            }
          }
          return { ...prev, unitZone: newUnitZone }
        })
        
        return { success: true, message: `${allyUnit.name} recebeu +2 DP! (${currentDp} -> ${newDp})` }
      } else if (chosenOption === "debuff") {
        // Debuff option: -2 DP to enemy unit
        if (!targets?.enemyUnitIndices?.length) {
          return { success: false, message: "Selecione uma unidade inimiga" }
        }
        
        const enemyIndex = targets.enemyUnitIndices[0]
        const enemyUnit = context.enemyField.unitZone[enemyIndex]
        
        if (!enemyUnit) {
          return { success: false, message: "Unidade inimiga nao encontrada" }
        }
        
        const currentDp = enemyUnit.currentDp || enemyUnit.dp
        const newDp = Math.max(0, currentDp - 2)
        
        context.setEnemyField((prev) => {
          const newUnitZone = [...prev.unitZone]
          if (newUnitZone[enemyIndex]) {
            newUnitZone[enemyIndex] = {
              ...newUnitZone[enemyIndex]!,
              currentDp: newDp,
            }
          }
          return { ...prev, unitZone: newUnitZone }
        })
        
        return { success: true, message: `${enemyUnit.name} perdeu 2 DP! (${currentDp} -> ${newDp})` }
      }
      
      return { success: false, message: "Escolha uma opcao" }
    },
  },
  
  "nucleo-explosivo": {
    id: "nucleo-explosivo",
    name: "Núcleo Explosivo",
    requiresTargets: false,
    canActivate: (context) => {
      // Check if opponent has at least 1 unit on field
      const enemyUnitCount = context.enemyField.unitZone.filter((u) => u !== null).length
      
      if (enemyUnitCount === 0) {
        return { canActivate: false, reason: "O oponente precisa ter ao menos 1 unidade no campo" }
      }
      return { canActivate: true }
    },
    resolve: (context) => {
      // Deal 1 damage to each enemy unit
      let unitsHit = 0
      
      context.setEnemyField((prev) => ({
        ...prev,
        unitZone: prev.unitZone.map((unit) => {
          if (unit === null) return null
          unitsHit++
          const currentDp = unit.currentDp || unit.dp
          const newDp = Math.max(0, currentDp - 1)
          return {
            ...unit,
            currentDp: newDp,
          }
        }),
      }))
      
      return { success: true, message: `1 de dano em ${unitsHit} unidade(s) inimigas!` }
    },
  },
  
  "kit-medico-improvisado": {
    id: "kit-medico-improvisado",
    name: "Kit Médico Improvisado",
    requiresTargets: false,
    needsDrawAfterResolve: true,
    canActivate: (context) => {
      const currentLife = context.playerField.life
      const maxLife = 20
      
      if (currentLife >= maxLife) {
        return { canActivate: false, reason: "LP ja esta no maximo" }
      }
      return { canActivate: true }
    },
    resolve: (context) => {
      const currentLife = context.playerField.life
      const maxLife = 20
      const healAmount = Math.min(2, maxLife - currentLife)
      const newLife = Math.min(currentLife + healAmount, maxLife)
      
      context.setPlayerField((prev) => ({
        ...prev,
        life: newLife,
      }))
      
      // Return special flag to indicate we need to draw and check for Unit type
      return { 
        success: true, 
        message: `+${healAmount} LP restaurado! (${currentLife} -> ${newLife})`,
        needsDrawAndCheckUnit: true,
        currentLife: newLife,
      }
    },
  },
  
  "soro-recuperador": {
    id: "soro-recuperador",
    name: "Soro Recuperador",
    requiresTargets: false,
    needsDrawAfterResolve: true,
    canActivate: (context) => {
      const currentLife = context.playerField.life
      const maxLife = 20
      
      if (currentLife >= maxLife) {
        return { canActivate: false, reason: "LP ja esta no maximo" }
      }
      return { canActivate: true }
    },
    resolve: (context) => {
      const currentLife = context.playerField.life
      const maxLife = 20
      const healAmount = Math.min(3, maxLife - currentLife)
      const newLife = Math.min(currentLife + healAmount, maxLife)
      
      context.setPlayerField((prev) => ({
        ...prev,
        life: newLife,
      }))
      
      // Return special flag to indicate we need to draw (no bonus check)
      return { 
        success: true, 
        message: `+${healAmount} LP restaurado! (${currentLife} -> ${newLife})`,
        needsDrawOnly: true,
        currentLife: newLife,
      }
    },
  },
  
  "ordem-de-laceracao": {
    id: "ordem-de-laceracao",
    name: "Ordem de Laceração",
    requiresTargets: false,
    canActivate: (context) => {
      // Check if player has Fehnon Hoskie on field
      const hasFehnon = context.playerField.unitZone.some((u) => 
        u !== null && u.name === "Fehnon Hoskie"
      )
      
      if (!hasFehnon) {
        return { canActivate: false, reason: "Voce precisa ter Fehnon Hoskie no campo" }
      }
      return { canActivate: true }
    },
    resolve: (context) => {
      // Deal 3 direct damage to enemy LP (ignores unit abilities)
      const damage = 3
      const currentEnemyLife = context.enemyField.life
      const newEnemyLife = Math.max(0, currentEnemyLife - damage)
      
      context.setEnemyField((prev) => ({
        ...prev,
        life: newEnemyLife,
      }))
      
      return { success: true, message: `3 de dano direto! LP do oponente: ${currentEnemyLife} -> ${newEnemyLife}` }
    },
  },
  
  "sinfonia-relampago": {
    id: "sinfonia-relampago",
    name: "Sinfonia Relâmpago",
    requiresTargets: false,
    canActivate: (context) => {
      // Check if player has Morgana Pendragon on field
      const hasMorgana = context.playerField.unitZone.some((u) => 
        u !== null && u.name === "Morgana Pendragon"
      )
      
      if (!hasMorgana) {
        return { canActivate: false, reason: "Voce precisa ter Morgana Pendragon no campo" }
      }
      return { canActivate: true }
    },
    resolve: (context) => {
      // Deal 4 direct damage to enemy LP (cannot be negated by traps)
      const damage = 4
      const currentEnemyLife = context.enemyField.life
      const newEnemyLife = Math.max(0, currentEnemyLife - damage)
      
      context.setEnemyField((prev) => ({
        ...prev,
        life: newEnemyLife,
      }))
      
      return { success: true, message: `4 de dano direto! LP do oponente: ${currentEnemyLife} -> ${newEnemyLife}` }
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
  // Check if player has Scandinavian Angel Hrotti on field (any variant name)
  const hasHrotti = context.playerField.unitZone.some((u) =>
  u !== null && (u.name === "Scandinavian Angel Hrotti" || u.name?.toLowerCase().includes("hrotti"))
  )
  
  if (!hasHrotti) {
  return { canActivate: false, reason: "Voce precisa ter Scandinavian Angel Hrotti no campo" }
  }
  return { canActivate: true }
  },
    resolve: (context, targets) => {
      const chosenOption = targets?.chosenOption
      
      if (chosenOption === "lp") {
        // Direct damage to LP
        const damage = 3
        const currentEnemyLife = context.enemyField.life
        const newEnemyLife = Math.max(0, currentEnemyLife - damage)
        
        context.setEnemyField((prev) => ({
          ...prev,
          life: newEnemyLife,
        }))
        
        return { success: true, message: `Fafnisbani! 3 de dano direto! LP: ${currentEnemyLife} -> ${newEnemyLife}` }
      } else if (chosenOption === "unit") {
        // Damage to enemy unit
        if (!targets?.enemyUnitIndices?.length) {
          return { success: false, message: "Selecione uma unidade inimiga" }
        }
        
        const enemyIndex = targets.enemyUnitIndices[0]
        const enemyUnit = context.enemyField.unitZone[enemyIndex]
        
        if (!enemyUnit) {
          return { success: false, message: "Unidade inimiga nao encontrada" }
        }
        
        const currentDp = enemyUnit.currentDp || enemyUnit.dp
        const newDp = Math.max(0, currentDp - 3)
        const isDestroyed = newDp <= 0
        
        context.setEnemyField((prev) => {
          const newUnitZone = [...prev.unitZone]
          const newGraveyard = [...prev.graveyard]
          
          if (isDestroyed) {
            // Unit is destroyed - send to graveyard
            if (newUnitZone[enemyIndex]) {
              newGraveyard.push(newUnitZone[enemyIndex]!)
            }
            newUnitZone[enemyIndex] = null
          } else {
            // Unit survives with reduced DP
            if (newUnitZone[enemyIndex]) {
              newUnitZone[enemyIndex] = {
                ...newUnitZone[enemyIndex]!,
                currentDp: newDp,
              }
            }
          }
          return { ...prev, unitZone: newUnitZone, graveyard: newGraveyard }
        })
        
        if (isDestroyed) {
          return { success: true, message: `Fafnisbani! ${enemyUnit.name} foi destruido!` }
        }
        return { success: true, message: `Fafnisbani! ${enemyUnit.name} recebeu 3 de dano! (${currentDp} -> ${newDp})` }
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
      // Check if player has Scandinavian Angel Logi on field (any variant name)
      const hasLogi = context.playerField.unitZone.some((u) => 
        u !== null && (u.name === "Scandinavian Angel Logi" || u.name?.toLowerCase().includes("logi"))
      )
      
      if (!hasLogi) {
        return { canActivate: false, reason: "Voce precisa ter Scandinavian Angel Logi no campo" }
      }
      return { canActivate: true }
    },
    resolve: (context, targets) => {
      const chosenOption = targets?.chosenOption
      
      if (chosenOption === "lp") {
        // Direct damage to LP
        const damage = 4
        const currentEnemyLife = context.enemyField.life
        const newEnemyLife = Math.max(0, currentEnemyLife - damage)
        
        context.setEnemyField((prev) => ({
          ...prev,
          life: newEnemyLife,
        }))
        
        return { success: true, message: `Devorar o Mundo! 4 de dano direto! LP: ${currentEnemyLife} -> ${newEnemyLife}` }
      } else if (chosenOption === "unit") {
        // Damage to enemy unit
        if (!targets?.enemyUnitIndices?.length) {
          return { success: false, message: "Selecione uma unidade inimiga" }
        }
        
        const enemyIndex = targets.enemyUnitIndices[0]
        const enemyUnit = context.enemyField.unitZone[enemyIndex]
        
        if (!enemyUnit) {
          return { success: false, message: "Unidade inimiga nao encontrada" }
        }
        
        const currentDp = enemyUnit.currentDp || enemyUnit.dp
        const newDp = Math.max(0, currentDp - 4)
        const isDestroyed = newDp <= 0
        
        context.setEnemyField((prev) => {
          const newUnitZone = [...prev.unitZone]
          const newGraveyard = [...prev.graveyard]
          
          if (isDestroyed) {
            // Unit is destroyed - send to graveyard
            if (newUnitZone[enemyIndex]) {
              newGraveyard.push(newUnitZone[enemyIndex]!)
            }
            newUnitZone[enemyIndex] = null
          } else {
            // Unit survives with reduced DP
            if (newUnitZone[enemyIndex]) {
              newUnitZone[enemyIndex] = {
                ...newUnitZone[enemyIndex]!,
                currentDp: newDp,
              }
            }
          }
          return { ...prev, unitZone: newUnitZone, graveyard: newGraveyard }
        })
        
        if (isDestroyed) {
          return { success: true, message: `Devorar o Mundo! ${enemyUnit.name} foi destruido!` }
        }
        return { success: true, message: `Devorar o Mundo! ${enemyUnit.name} recebeu 4 de dano! (${currentDp} -> ${newDp})` }
      }
      
      return { success: false, message: "Escolha uma opcao" }
    },
  },
  
  // ========== DICE FUNCTION CARDS ==========
  
  "dados-do-destino-gentil": {
    id: "dados-do-destino-gentil",
    name: "Dados do Destino Gentil",
    requiresTargets: true,
    requiresDice: true,
    targetConfig: {
      allyUnits: 1,
    },
    canActivate: (context) => {
      const hasAllyUnits = context.playerField.unitZone.some((u) => u !== null)
      if (!hasAllyUnits) {
        return { canActivate: false, reason: "Voce precisa ter uma unidade em campo" }
      }
      return { canActivate: true }
    },
    resolve: (context, targets) => {
      if (!targets?.allyUnitIndices?.length) {
        return { success: false, message: "Selecione uma unidade sua" }
      }
      
      const allyIndex = targets.allyUnitIndices[0]
      const allyUnit = context.playerField.unitZone[allyIndex]
      
      if (!allyUnit) {
        return { success: false, message: "Unidade nao encontrada" }
      }
      
      const diceResult = targets.diceResult || 1
      const currentDp = allyUnit.currentDp || allyUnit.dp
      
      if (diceResult >= 1 && diceResult <= 3) {
        // 1-3: -3 DP
        const newDp = Math.max(0, currentDp - 3)
        const isDestroyed = newDp <= 0
        
        context.setPlayerField((prev) => {
          const newUnitZone = [...prev.unitZone]
          const newGraveyard = [...prev.graveyard]
          
          if (isDestroyed) {
            if (newUnitZone[allyIndex]) {
              newGraveyard.push(newUnitZone[allyIndex]!)
            }
            newUnitZone[allyIndex] = null
          } else {
            if (newUnitZone[allyIndex]) {
              newUnitZone[allyIndex] = { ...newUnitZone[allyIndex]!, currentDp: newDp }
            }
          }
          return { ...prev, unitZone: newUnitZone, graveyard: newGraveyard }
        })
        
        if (isDestroyed) {
          return { success: true, message: `Dado: ${diceResult}! ${allyUnit.name} perdeu 3 DP e foi destruida!` }
        }
        return { success: true, message: `Dado: ${diceResult}! ${allyUnit.name} perdeu 3 DP (${currentDp} -> ${newDp})` }
      } else {
        // 4-6: +5 DP
        const newDp = currentDp + 5
        
        context.setPlayerField((prev) => {
          const newUnitZone = [...prev.unitZone]
          if (newUnitZone[allyIndex]) {
            newUnitZone[allyIndex] = { ...newUnitZone[allyIndex]!, currentDp: newDp }
          }
          return { ...prev, unitZone: newUnitZone }
        })
        
        return { success: true, message: `Dado: ${diceResult}! ${allyUnit.name} ganhou +5 DP! (${currentDp} -> ${newDp})` }
      }
    },
  },
  
  "dados-elementais-alpha": {
    id: "dados-elementais-alpha",
    name: "Dados Elementais Alpha",
    requiresTargets: true,
    requiresDice: true,
    targetConfig: {
      allyUnits: 1,
    },
    canActivate: (context) => {
      // Check for units with Darkness, Fire, or Aquos elements
      const validElements = ["darkness", "fire", "aquos"]
      const hasValidUnit = context.playerField.unitZone.some((u) => 
        u !== null && validElements.includes(u.element?.toLowerCase() || "")
      )
      if (!hasValidUnit) {
        return { canActivate: false, reason: "Precisa de unidade Darkness, Fire ou Aquos em campo" }
      }
      return { canActivate: true }
    },
    resolve: (context, targets) => {
      if (!targets?.allyUnitIndices?.length) {
        return { success: false, message: "Selecione uma unidade sua" }
      }
      
      const allyIndex = targets.allyUnitIndices[0]
      const allyUnit = context.playerField.unitZone[allyIndex]
      
      if (!allyUnit) {
        return { success: false, message: "Unidade nao encontrada" }
      }
      
      const validElements = ["darkness", "fire", "aquos"]
      const unitElement = allyUnit.element?.toLowerCase() || ""
      
      if (!validElements.includes(unitElement)) {
        return { success: false, message: "Unidade deve ser Darkness, Fire ou Aquos" }
      }
      
      const diceResult = targets.diceResult || 1
      const currentDp = allyUnit.currentDp || allyUnit.dp
      let dpBonus = 0
      let bonusMessage = ""
      
      if (diceResult >= 1 && diceResult <= 2) {
        dpBonus = 3
        if (unitElement === "darkness") {
          // Bonus: Draw 1 card
          if (context.playerField.deck.length > 0) {
            const drawnCard = context.playerField.deck[0]
            context.setPlayerField((prev) => ({
              ...prev,
              hand: [...prev.hand, drawnCard],
              deck: prev.deck.slice(1),
            }))
            bonusMessage = " Bonus Darkness: Comprou 1 carta!"
          }
        }
      } else if (diceResult >= 3 && diceResult <= 4) {
        dpBonus = 4
        if (unitElement === "fire") {
          // Bonus: +2 LP
          context.setPlayerField((prev) => ({ ...prev, life: prev.life + 2 }))
          bonusMessage = " Bonus Fire: +2 LP!"
        }
      } else {
        dpBonus = 5
        if (unitElement === "aquos") {
          // Bonus: +3 LP
          context.setPlayerField((prev) => ({ ...prev, life: prev.life + 3 }))
          bonusMessage = " Bonus Aquos: +3 LP!"
        }
      }
      
      const newDp = currentDp + dpBonus
      context.setPlayerField((prev) => {
        const newUnitZone = [...prev.unitZone]
        if (newUnitZone[allyIndex]) {
          newUnitZone[allyIndex] = { ...newUnitZone[allyIndex]!, currentDp: newDp }
        }
        return { ...prev, unitZone: newUnitZone }
      })
      
      return { success: true, message: `Dado: ${diceResult}! ${allyUnit.name} +${dpBonus} DP!${bonusMessage}` }
    },
  },
  
  "dados-elementais-omega": {
    id: "dados-elementais-omega",
    name: "Dados Elementais Omega",
    requiresTargets: true,
    requiresDice: true,
    targetConfig: {
      allyUnits: 1,
    },
    canActivate: (context) => {
      // Check for units with Neutral, Lightness, or Ventus elements
      const validElements = ["neutral", "lightness", "ventus"]
      const hasValidUnit = context.playerField.unitZone.some((u) => 
        u !== null && validElements.includes(u.element?.toLowerCase() || "")
      )
      if (!hasValidUnit) {
        return { canActivate: false, reason: "Precisa de unidade Neutral, Lightness ou Ventus em campo" }
      }
      return { canActivate: true }
    },
    resolve: (context, targets) => {
      if (!targets?.allyUnitIndices?.length) {
        return { success: false, message: "Selecione uma unidade sua" }
      }
      
      const allyIndex = targets.allyUnitIndices[0]
      const allyUnit = context.playerField.unitZone[allyIndex]
      
      if (!allyUnit) {
        return { success: false, message: "Unidade nao encontrada" }
      }
      
      const validElements = ["neutral", "lightness", "ventus"]
      const unitElement = allyUnit.element?.toLowerCase() || ""
      
      if (!validElements.includes(unitElement)) {
        return { success: false, message: "Unidade deve ser Neutral, Lightness ou Ventus" }
      }
      
      const diceResult = targets.diceResult || 1
      const currentDp = allyUnit.currentDp || allyUnit.dp
      let dpBonus = 0
      let bonusMessage = ""
      
      if (diceResult >= 1 && diceResult <= 2) {
        dpBonus = 3
        if (unitElement === "neutral") {
          // Bonus: Draw 1 card
          if (context.playerField.deck.length > 0) {
            const drawnCard = context.playerField.deck[0]
            context.setPlayerField((prev) => ({
              ...prev,
              hand: [...prev.hand, drawnCard],
              deck: prev.deck.slice(1),
            }))
            bonusMessage = " Bonus Neutral: Comprou 1 carta!"
          }
        }
      } else if (diceResult >= 3 && diceResult <= 4) {
        dpBonus = 4
        if (unitElement === "lightness") {
          // Bonus: +2 LP
          context.setPlayerField((prev) => ({ ...prev, life: prev.life + 2 }))
          bonusMessage = " Bonus Lightness: +2 LP!"
        }
      } else {
        dpBonus = 5
        if (unitElement === "ventus") {
          // Bonus: +3 LP
          context.setPlayerField((prev) => ({ ...prev, life: prev.life + 3 }))
          bonusMessage = " Bonus Ventus: +3 LP!"
        }
      }
      
      const newDp = currentDp + dpBonus
      context.setPlayerField((prev) => {
        const newUnitZone = [...prev.unitZone]
        if (newUnitZone[allyIndex]) {
          newUnitZone[allyIndex] = { ...newUnitZone[allyIndex]!, currentDp: newDp }
        }
        return { ...prev, unitZone: newUnitZone }
      })
      
      return { success: true, message: `Dado: ${diceResult}! ${allyUnit.name} +${dpBonus} DP!${bonusMessage}` }
    },
  },
}

// Helper function to extract base card ID (removes deck timestamp suffix)
const getBaseCardId = (cardId: string): string => {
  // Card IDs in deck are formatted as: "original-id-deck-timestamp"
  // We need to extract just "original-id"
  const deckSuffixIndex = cardId.lastIndexOf("-deck-")
  if (deckSuffixIndex !== -1) {
    return cardId.substring(0, deckSuffixIndex)
  }
  return cardId
}

// Helper function to get effect for a card - also checks by card name
const getFunctionCardEffect = (card: { id: string; name?: string }): FunctionCardEffect | null => {
  // First try by base ID
  const baseId = getBaseCardId(card.id)
  if (FUNCTION_CARD_EFFECTS[baseId]) {
    return FUNCTION_CARD_EFFECTS[baseId]
  }
  
  // Fallback: try to match by card name
  const effectByName = Object.values(FUNCTION_CARD_EFFECTS).find(
    (effect) => effect.name === card.name
  )
  return effectByName || null
}

// Helper to check if a Function card can be activated
const canActivateFunctionCard = (cardId: string, context: EffectContext): { canActivate: boolean; reason?: string } => {
  const effect = getFunctionCardEffect(cardId)
  if (!effect) {
    return { canActivate: true } // Unknown cards can be placed normally
  }
  return effect.canActivate(context)
}

// Function to get playmat for a deck
// REMOVED: const getPlaymatForDeck = (deck: DeckWithImages): { image: string } | null => {
//   if (!deck.playmatImage) return null
//   return { image: deck.playmatImage }
// }

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
    case "void":
      return ["#1a1a2e", "#16213e", "#0f3460", "#533483", "#e94560"]
    case "terra":
      return ["#8b4513", "#a0522d", "#cd853f", "#d2691e", "#deb887"]
    case "neutral":
      return ["#c0c0c0", "#a9a9a9", "#808080", "#d3d3d3", "#dcdcdc"]
    default:
      return ["#ffffff", "#f0f0f0", "#e0e0e0", "#d0d0d0", "#c0c0c0"]
  }
}

const getElementGlow = (element: string): string => {
  const el = element?.toLowerCase()
  switch (el) {
    case "aquos":
    case "aquo":
      return "rgba(0, 191, 255, 0.8)"
    case "fire":
    case "pyrus":
      return "rgba(255, 69, 0, 0.8)"
    case "ventus":
      return "rgba(50, 205, 50, 0.8)"
    case "darkness":
    case "darkus":
    case "dark":
      return "rgba(153, 50, 204, 0.8)"
    case "lightness":
    case "haos":
    case "light":
      return "rgba(255, 215, 0, 0.8)"
    case "void":
      return "rgba(233, 69, 96, 0.8)"
    case "terra":
      return "rgba(139, 69, 19, 0.8)"
    default:
      return "rgba(255, 255, 255, 0.8)"
  }
}

export function DuelScreen({ mode, onBack }: DuelScreenProps) {
  const { t } = useLanguage()
  // IMPORTED: const { decks, addMatchRecord, getPlaymatForDeck } = useGame()
  const { decks, addMatchRecord, getPlaymatForDeck, ownedPlaymats, globalPlaymatId } = useGame()
  // Ensure decks are typed correctly if they have playmat images
  const typedDecks = decks as DeckWithImages[]
  const [selectedDeck, setSelectedDeck] = useState<DeckWithImages | null>(null)
  const [gameStarted, setGameStarted] = useState(false)
  
  // Multiplayer state
  const [multiplayerRoomData, setMultiplayerRoomData] = useState<RoomData | null>(null)
  const [showOnlineDuel, setShowOnlineDuel] = useState(false)
  
  const [turn, setTurn] = useState(1)
  const [phase, setPhase] = useState<Phase>("draw")
  const [isPlayerTurn, setIsPlayerTurn] = useState(true)
  
  // Draw card animation state
  const [drawAnimation, setDrawAnimation] = useState<{
    visible: boolean
    cardName: string
    cardImage: string
    cardType: string
  } | null>(null)
  const [playerWentFirst, setPlayerWentFirst] = useState(true)
  const [playerField, setPlayerField] = useState<FieldState>({
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
  const [enemyField, setEnemyField] = useState<FieldState>({
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
  const [selectedHandCard, setSelectedHandCard] = useState<number | null>(null)
  const [gameResult, setGameResult] = useState<"won" | "lost" | null>(null)

  const [attackState, setAttackState] = useState<AttackState>({
    isAttacking: false,
    attackerIndex: null,
    targetInfo: null, // Initialize targetInfo
  })
  const [attackTarget, setAttackTarget] = useState<{ type: "direct" | "unit"; index?: number } | null>(null)
const [itemSelectionMode, setItemSelectionMode] = useState<{
  active: boolean
  itemCard: GameCard | null
  step: "selectEnemy" | "selectAlly" | "selectChoice"
  selectedEnemyIndex: number | null
  chosenOption: string | null
  }>({ active: false, itemCard: null, step: "selectEnemy", selectedEnemyIndex: null, chosenOption: null })
  
  // State for choice modal (for cards like Véu dos Laços Cruzados)
  const [choiceModal, setChoiceModal] = useState<{
    visible: boolean
    cardName: string
    options: { id: string; label: string; description: string }[]
    onChoose: (optionId: string) => void
  } | null>(null)

  const [arrowPos, setArrowPos] = useState({ x1: 0, y1: 0, x2: 0, y2: 0 })

  const [explosionEffects, setExplosionEffects] = useState<ExplosionEffect[]>([])
  const explosionCanvasRef = useRef<HTMLCanvasElement>(null)
  const activeParticlesRef = useRef<Map<string, { particles: Particle[], startTime: number, element: string, x: number, y: number }>>(new Map())
  const [impactFlash, setImpactFlash] = useState<{ active: boolean; color: string }>({ active: false, color: "#ffffff" })
  
  // Destruction animation state
  const [destructionAnimation, setDestructionAnimation] = useState<{
    id: string
    cardName: string
    cardImage: string
    x: number
    y: number
    element: string
  } | null>(null)
  
  // Dice roll animation state
  const [diceAnimation, setDiceAnimation] = useState<{
    visible: boolean
    rolling: boolean
    result: number | null
    cardName: string
    onComplete: ((result: number) => void) | null
  } | null>(null)

  const [draggedHandCard, setDraggedHandCard] = useState<{
    index: number
    card: GameCard
  } | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const [droppingCard, setDroppingCard] = useState<{
    card: GameCard
    targetX: number
    targetY: number
  } | null>(null)
  const [inspectedCard, setInspectedCard] = useState<GameCard | null>(null)
  const [graveyardView, setGraveyardView] = useState<"player" | "enemy" | null>(null)
  const [effectFeedback, setEffectFeedback] = useState<{ active: boolean; message: string; type: "success" | "error" } | null>(null)

  // Ultimate Gear effect tracking
  const [playerUgAbilityUsed, setPlayerUgAbilityUsed] = useState(false) // One-time ability used (ODEN SWORD, TWILIGH AVALON)
  const [enemyUgAbilityUsed, setEnemyUgAbilityUsed] = useState(false)
  const [ugTargetMode, setUgTargetMode] = useState<{
    active: boolean
    ugCard: GameCard | null
    type: "oden_sword" | "twiligh_avalon" | null
  }>({ active: false, ugCard: null, type: null })
  const [fornbrennaFireCount, setFornbrennaFireCount] = useState(0) // Snapshot of fire units used when Fornbrenna is placed

  // Track last known unit zone state to detect when a matching unit is placed after UG
  const prevUnitZoneRef = useRef<(string | null)[]>([])
  useEffect(() => {
    if (!playerField.ultimateZone || !playerField.ultimateZone.requiresUnit) {
      prevUnitZoneRef.current = playerField.unitZone.map((u) => u?.name || null)
      return
    }

    const ug = playerField.ultimateZone
    const requiredUnit = ug.requiresUnit!
    const ability = ug.ability
    const prevNames = prevUnitZoneRef.current
    const currentNames = playerField.unitZone.map((u) => u?.name || null)

    // Check if the required unit just appeared (wasn't there before)
    const wasPresent = prevNames.some((n) => n === requiredUnit)
    const isNowPresent = currentNames.some((n) => n === requiredUnit)

    if (!wasPresent && isNowPresent) {
      // Unit just appeared - apply passive DP bonus
      const unitIdx = playerField.unitZone.findIndex((u) => u && u.name === requiredUnit)
      if (unitIdx !== -1) {
        setPlayerField((prev) => {
          const newUnits = [...prev.unitZone]
          const unit = newUnits[unitIdx]
          if (!unit) return prev

          let bonus = 0
          let msg = ""
          if (ability === "ODEN SWORD") { bonus = 4; msg = `${requiredUnit} +4 DP (Oden Sword)!` }
          else if (ability === "PROTONIX SWORD") { bonus = 2; msg = `${requiredUnit} +2 DP (Protonix Sword)!` }
          else if (ability === "TWILIGH AVALON") { bonus = 2; msg = `${requiredUnit} +2 DP (Twiligh Avalon)!` }
          else if (ability === "ULLRBOGI") { msg = `${requiredUnit} recebera +3 DP nas fases de batalha (Ullrbogi)!` }
          else if (ability === "FORNBRENNA") {
            const fireCount = countFireUnitsUsed(prev)
            bonus = fireCount * 2
            setFornbrennaFireCount(fireCount)
            msg = `${requiredUnit} +${bonus} DP (Fornbrenna, ${fireCount} fogo)!`
          }

          if (bonus > 0) {
            newUnits[unitIdx] = { ...unit, currentDp: unit.currentDp + bonus }
          }
          if (msg) showEffectFeedback(msg, "success")
          return { ...prev, unitZone: newUnits as (FieldCard | null)[] }
        })
      }
    }

    prevUnitZoneRef.current = currentNames
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerField.unitZone, playerField.ultimateZone])

  const cardPressTimer = useRef<NodeJS.Timeout | null>(null)
  const draggedCardRef = useRef<HTMLDivElement>(null)
  const dragPosRef = useRef({ x: 0, y: 0, rotation: 0, lastCheck: 0 })

  const positionRef = useRef({ startX: 0, startY: 0, currentX: 0, currentY: 0, lastTargetCheck: 0 })
  const arrowRef = useRef<SVGLineElement>(null)
  const rafRef = useRef<number | null>(null)
  const fieldRef = useRef<HTMLDivElement>(null)
  const enemyUnitRectsRef = useRef<DOMRect[]>([])
  const isDraggingRef = useRef(false) // Track drag state
  const playerCardsRef = useRef<(HTMLDivElement | null)[]>([]) // Added for player unit zone refs

  const gameResultRecordedRef = useRef(false)

  // Helper to show effect feedback
  const showEffectFeedback = useCallback((message: string, type: "success" | "error") => {
  setEffectFeedback({ active: true, message, type })
  setTimeout(() => setEffectFeedback(null), 2000)
  }, [])
  
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
  
  // Helper to show destruction animation
  const showDestructionAnimation = useCallback((card: GameCard, x: number, y: number) => {
    const id = `destruction-${Date.now()}`
    setDestructionAnimation({
      id,
      cardName: card.name,
      cardImage: card.image,
      x,
      y,
      element: card.element || "neutral",
    })
    setTimeout(() => setDestructionAnimation(null), 1200)
  }, [])
  
  // Helper to roll dice with animation
  const rollDice = useCallback((cardName: string): Promise<number> => {
    return new Promise((resolve) => {
      // Start animation
      setDiceAnimation({
        visible: true,
        rolling: true,
        result: null,
        cardName,
        onComplete: null,
      })
      
      // Roll for 2 seconds then show result
      setTimeout(() => {
        const result = Math.floor(Math.random() * 6) + 1
        setDiceAnimation((prev) => prev ? {
          ...prev,
          rolling: false,
          result,
        } : null)
        
        // Wait for result display then resolve
        setTimeout(() => {
          setDiceAnimation(null)
          resolve(result)
        }, 1500)
      }, 2000)
    })
  }, [])
  
  // Helper to resolve effect with dice roll if needed
  const resolveEffectWithDice = useCallback(async (
    effect: FunctionCardEffect,
    effectContext: EffectContext,
    targets: EffectTargets,
    cardName: string
  ): Promise<EffectResult> => {
    if (effect.requiresDice) {
      const diceResult = await rollDice(cardName)
      return effect.resolve(effectContext, { ...targets, diceResult })
    }
    return effect.resolve(effectContext, targets)
  }, [rollDice])
  
  // If mode is "player", show the multiplayer lobby system
  if (mode === "player" && !showOnlineDuel) {
    return (
      <MultiplayerLobby
        onBack={onBack}
        onStartDuel={(roomData) => {
          setMultiplayerRoomData(roomData)
          setShowOnlineDuel(true)
        }}
      />
    )
  }
  
  // If online duel started, show the online duel screen
  if (mode === "player" && showOnlineDuel && multiplayerRoomData) {
    return (
      <OnlineDuelScreen
        roomData={multiplayerRoomData}
        onBack={() => {
          setShowOnlineDuel(false)
          setMultiplayerRoomData(null)
          onBack()
        }}
      />
    )
  }

  const triggerExplosion = useCallback((targetX: number, targetY: number, element: string) => {
    const colors = getElementColors(element)
    const particles: Particle[] = []
    const el = element?.toLowerCase()

    // AQUO/AQUOS - Concentrated water impact
    if (el === "aquos" || el === "aquo") {
      // Central water burst - contained
      for (let i = 0; i < 40; i++) {
        const angle = (Math.PI * 2 * i) / 40 + Math.random() * 0.15
        const speed = 1.5 + Math.random() * 3
        particles.push({
          x: targetX,
          y: targetY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 2,
          size: 4 + Math.random() * 8,
          color: colors[Math.floor(Math.random() * colors.length)],
          alpha: 1,
        })
      }
      // Glowing water droplets - smaller area
      for (let i = 0; i < 30; i++) {
        const angle = Math.random() * Math.PI * 2
        const speed = 2 + Math.random() * 3
        particles.push({
          x: targetX,
          y: targetY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 3,
          size: 2 + Math.random() * 4,
          color: "#00ffff",
          alpha: 1,
        })
      }
      // Bubbles rising - contained
      for (let i = 0; i < 20; i++) {
        particles.push({
          x: targetX + (Math.random() - 0.5) * 30,
          y: targetY + Math.random() * 15,
          vx: (Math.random() - 0.5) * 1,
          vy: -1 - Math.random() * 2,
          size: 5 + Math.random() * 8,
          color: "rgba(0, 255, 255, 0.7)",
          alpha: 0.8,
        })
      }
      // Water wave ring - single focused
      for (let i = 0; i < 30; i++) {
        const angle = (Math.PI * 2 * i) / 30
        const speed = 1.5 + Math.random() * 2
        particles.push({
          x: targetX,
          y: targetY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed * 0.4,
          size: 3 + Math.random() * 4,
          color: "#00ffff",
          alpha: 0.9,
        })
      }
      // Core energy burst - small
      for (let i = 0; i < 15; i++) {
        particles.push({
          x: targetX,
          y: targetY,
          vx: (Math.random() - 0.5) * 1.5,
          vy: (Math.random() - 0.5) * 1.5,
          size: 10 + Math.random() * 15,
          color: "rgba(255, 255, 255, 0.9)",
          alpha: 0.9,
        })
      }
    }
    // FIRE/PYRUS - Inferno explosion with blazing flames
    else if (el === "fire" || el === "pyrus") {
      // Core inferno burst - white hot center
      for (let i = 0; i < 30; i++) {
        const angle = (Math.PI * 2 * i) / 30
        const speed = 3 + Math.random() * 5
        particles.push({
          x: targetX,
          y: targetY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 20 + Math.random() * 30,
          color: "#ffffff",
          alpha: 1,
        })
      }
      // Main fire explosion - intense flames
      for (let i = 0; i < 90; i++) {
        const angle = (Math.PI * 2 * i) / 90 + Math.random() * 0.25
        const speed = 7 + Math.random() * 14
        particles.push({
          x: targetX,
          y: targetY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 6,
          size: 10 + Math.random() * 18,
          color: colors[Math.floor(Math.random() * colors.length)],
          alpha: 1,
        })
      }
      // Towering flames rising
      for (let i = 0; i < 60; i++) {
        particles.push({
          x: targetX + (Math.random() - 0.5) * 70,
          y: targetY,
          vx: (Math.random() - 0.5) * 4,
          vy: -8 - Math.random() * 14,
          size: 18 + Math.random() * 30,
          color: i % 3 === 0 ? "#ff4500" : i % 3 === 1 ? "#ff6600" : "#ffcc00",
          alpha: 1,
        })
      }
      // Intense embers shower
      for (let i = 0; i < 80; i++) {
        const angle = Math.random() * Math.PI * 2
        const speed = 10 + Math.random() * 14
        particles.push({
          x: targetX,
          y: targetY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 10,
          size: 2 + Math.random() * 5,
          color: Math.random() > 0.5 ? "#ffff00" : "#ffffff",
          alpha: 1,
        })
      }
      // Fire rings expanding
      for (let ring = 0; ring < 3; ring++) {
        for (let i = 0; i < 40; i++) {
          const angle = (Math.PI * 2 * i) / 40
          const speed = (4 + ring * 3) + Math.random() * 3
          particles.push({
            x: targetX,
            y: targetY,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: 5 + Math.random() * 8,
            color: ring === 0 ? "#ff4500" : ring === 1 ? "#ff8c00" : "#ffa500",
            alpha: 0.9,
          })
        }
      }
      // Dark smoke plumes
      for (let i = 0; i < 25; i++) {
        particles.push({
          x: targetX + (Math.random() - 0.5) * 60,
          y: targetY,
          vx: (Math.random() - 0.5) * 3,
          vy: -3 - Math.random() * 5,
          size: 45 + Math.random() * 55,
          color: "rgba(40, 40, 40, 0.5)",
          alpha: 0.7,
        })
      }
    }
    // VENTUS - Raging tempest cyclone
    else if (el === "ventus") {
      // Central cyclone core
      for (let i = 0; i < 30; i++) {
        particles.push({
          x: targetX + (Math.random() - 0.5) * 30,
          y: targetY + (Math.random() - 0.5) * 30,
          vx: (Math.random() - 0.5) * 3,
          vy: (Math.random() - 0.5) * 3,
          size: 25 + Math.random() * 35,
          color: "rgba(144, 238, 144, 0.5)",
          alpha: 0.7,
        })
      }
      // Spiral wind particles - double helix
      for (let helix = 0; helix < 2; helix++) {
        for (let i = 0; i < 60; i++) {
          const spiralAngle = (i / 60) * Math.PI * 8 + helix * Math.PI
          const radius = 5 + (i / 60) * 80
          const speed = 5 + Math.random() * 8
          particles.push({
            x: targetX + Math.cos(spiralAngle) * radius * 0.4,
            y: targetY + Math.sin(spiralAngle) * radius * 0.4,
            vx: Math.cos(spiralAngle + Math.PI / 2) * speed,
            vy: Math.sin(spiralAngle + Math.PI / 2) * speed - 4,
            size: 5 + Math.random() * 10,
            color: colors[Math.floor(Math.random() * colors.length)],
            alpha: 0.9,
          })
        }
      }
      // Powerful wind gusts
      for (let i = 0; i < 50; i++) {
        const angle = Math.random() * Math.PI * 2
        const speed = 12 + Math.random() * 10
        particles.push({
          x: targetX,
          y: targetY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed * 0.5 - 5,
          size: 3 + Math.random() * 5,
          color: "#adff2f",
          alpha: 1,
        })
      }
      // Leaves and debris storm
      for (let i = 0; i < 45; i++) {
        const angle = Math.random() * Math.PI * 2
        const speed = 6 + Math.random() * 9
        particles.push({
          x: targetX + (Math.random() - 0.5) * 60,
          y: targetY + (Math.random() - 0.5) * 60,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 7 + Math.random() * 12,
          color: i % 4 === 0 ? "#228b22" : i % 4 === 1 ? "#90ee90" : i % 4 === 2 ? "#32cd32" : "#7cfc00",
          alpha: 0.9,
        })
      }
      // Wind streaks
      for (let i = 0; i < 20; i++) {
        const angle = Math.random() * Math.PI * 2
        particles.push({
          x: targetX,
          y: targetY,
          vx: Math.cos(angle) * 15,
          vy: Math.sin(angle) * 15,
          size: 2 + Math.random() * 3,
          color: "#ffffff",
          alpha: 0.8,
        })
      }
    }
    // DARK/DARKNESS - Abyssal void devastation
    else if (el === "darkness" || el === "darkus" || el === "dark") {
      // Void core implosion then explosion
      for (let i = 0; i < 25; i++) {
        particles.push({
          x: targetX + (Math.random() - 0.5) * 40,
          y: targetY + (Math.random() - 0.5) * 40,
          vx: (Math.random() - 0.5) * 2,
          vy: (Math.random() - 0.5) * 2,
          size: 35 + Math.random() * 45,
          color: "rgba(10, 0, 20, 0.9)",
          alpha: 0.95,
        })
      }
      // Dark energy burst
      for (let i = 0; i < 70; i++) {
        const angle = (Math.PI * 2 * i) / 70
        const speed = 6 + Math.random() * 10
        particles.push({
          x: targetX,
          y: targetY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 10 + Math.random() * 16,
          color: colors[Math.floor(Math.random() * colors.length)],
          alpha: 0.95,
        })
      }
      // Shadow tendrils reaching out - more dramatic
      for (let i = 0; i < 12; i++) {
        const baseAngle = (Math.PI * 2 * i) / 12
        for (let j = 0; j < 15; j++) {
          const dist = j * 7
          particles.push({
            x: targetX + Math.cos(baseAngle) * dist * 0.3,
            y: targetY + Math.sin(baseAngle) * dist * 0.3,
            vx: Math.cos(baseAngle) * (3 + j * 0.6),
            vy: Math.sin(baseAngle) * (3 + j * 0.6),
            size: 14 - j * 0.7,
            color: j % 3 === 0 ? "#4b0082" : j % 3 === 1 ? "#9932cc" : "#800080",
            alpha: 0.9 - j * 0.04,
          })
        }
      }
      // Dark mist expanding
      for (let i = 0; i < 35; i++) {
        particles.push({
          x: targetX + (Math.random() - 0.5) * 100,
          y: targetY + (Math.random() - 0.5) * 100,
          vx: (Math.random() - 0.5) * 3,
          vy: (Math.random() - 0.5) * 3,
          size: 50 + Math.random() * 60,
          color: "rgba(30, 0, 50, 0.6)",
          alpha: 0.7,
        })
      }
      // Purple energy sparks
      for (let i = 0; i < 50; i++) {
        const angle = Math.random() * Math.PI * 2
        const speed = 9 + Math.random() * 8
        particles.push({
          x: targetX,
          y: targetY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 3 + Math.random() * 4,
          color: Math.random() > 0.5 ? "#da70d6" : "#ff00ff",
          alpha: 1,
        })
      }
      // Cursed runes floating
      for (let i = 0; i < 20; i++) {
        const angle = Math.random() * Math.PI * 2
        const dist = 30 + Math.random() * 50
        particles.push({
          x: targetX + Math.cos(angle) * dist,
          y: targetY + Math.sin(angle) * dist,
          vx: Math.cos(angle) * 2,
          vy: Math.sin(angle) * 2 - 1,
          size: 8 + Math.random() * 12,
          color: "#9400d3",
          alpha: 0.85,
        })
      }
    }
    // LIGHT/LIGHTNESS - Divine judgment radiance
    else if (el === "lightness" || el === "haos" || el === "light") {
      // Blinding core flash
      for (let i = 0; i < 40; i++) {
        const angle = (Math.PI * 2 * i) / 40
        const speed = 2 + Math.random() * 4
        particles.push({
          x: targetX,
          y: targetY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 30 + Math.random() * 40,
          color: "#ffffff",
          alpha: 1,
        })
      }
      // Radiant burst
      for (let i = 0; i < 80; i++) {
        const angle = (Math.PI * 2 * i) / 80
        const speed = 7 + Math.random() * 12
        particles.push({
          x: targetX,
          y: targetY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 8 + Math.random() * 14,
          color: colors[Math.floor(Math.random() * colors.length)],
          alpha: 1,
        })
      }
      // Holy rays extending outward - more rays
      for (let i = 0; i < 16; i++) {
        const rayAngle = (Math.PI * 2 * i) / 16
        for (let j = 0; j < 12; j++) {
          particles.push({
            x: targetX,
            y: targetY,
            vx: Math.cos(rayAngle) * (5 + j * 2.5),
            vy: Math.sin(rayAngle) * (5 + j * 2.5),
            size: 18 - j * 1.2,
            color: j % 2 === 0 ? "#ffffff" : "#ffd700",
            alpha: 1 - j * 0.06,
          })
        }
      }
      // Divine sparkles shower
      for (let i = 0; i < 70; i++) {
        const angle = Math.random() * Math.PI * 2
        const speed = 4 + Math.random() * 8
        particles.push({
          x: targetX + (Math.random() - 0.5) * 80,
          y: targetY + (Math.random() - 0.5) * 80,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 3,
          size: 3 + Math.random() * 6,
          color: Math.random() > 0.3 ? "#ffffff" : "#fffacd",
          alpha: 1,
        })
      }
      // Golden halo rings
      for (let ring = 0; ring < 3; ring++) {
        for (let i = 0; i < 40; i++) {
          const angle = (Math.PI * 2 * i) / 40
          const radius = (40 + ring * 25) + Math.random() * 15
          particles.push({
            x: targetX + Math.cos(angle) * radius * 0.3,
            y: targetY + Math.sin(angle) * radius * 0.3,
            vx: Math.cos(angle) * (3 + ring),
            vy: Math.sin(angle) * (3 + ring),
            size: 5 + Math.random() * 7,
            color: ring === 0 ? "#ffd700" : ring === 1 ? "#ffff00" : "#fffacd",
            alpha: 0.9,
          })
        }
      }
      // Ascending light particles
      for (let i = 0; i < 30; i++) {
        particles.push({
          x: targetX + (Math.random() - 0.5) * 100,
          y: targetY,
          vx: (Math.random() - 0.5) * 2,
          vy: -5 - Math.random() * 8,
          size: 6 + Math.random() * 10,
          color: "#ffffff",
          alpha: 0.9,
        })
      }
    }
    // VOID - Reality-shattering dimensional rift
    else if (el === "void") {
      // Dimensional core collapse
      for (let i = 0; i < 25; i++) {
        particles.push({
          x: targetX + (Math.random() - 0.5) * 40,
          y: targetY + (Math.random() - 0.5) * 40,
          vx: (Math.random() - 0.5) * 2,
          vy: (Math.random() - 0.5) * 2,
          size: 40 + Math.random() * 50,
          color: "rgba(5, 5, 20, 0.9)",
          alpha: 0.95,
        })
      }
      // Void rift explosion
      for (let i = 0; i < 70; i++) {
        const angle = (Math.PI * 2 * i) / 70 + Math.random() * 0.2
        const speed = 6 + Math.random() * 11
        particles.push({
          x: targetX,
          y: targetY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 8 + Math.random() * 14,
          color: colors[Math.floor(Math.random() * colors.length)],
          alpha: 0.95,
        })
      }
      // Reality fractures - multiple jagged cracks
      for (let i = 0; i < 10; i++) {
        const baseAngle = (Math.PI * 2 * i) / 10
        for (let j = 0; j < 15; j++) {
          const jitter = (Math.random() - 0.5) * 0.6
          particles.push({
            x: targetX,
            y: targetY,
            vx: Math.cos(baseAngle + jitter) * (4 + j * 1.3),
            vy: Math.sin(baseAngle + jitter) * (4 + j * 1.3),
            size: 5 + Math.random() * 5,
            color: j % 4 === 0 ? "#e94560" : j % 4 === 1 ? "#533483" : j % 4 === 2 ? "#0f3460" : "#ff1493",
            alpha: 1 - j * 0.04,
          })
        }
      }
      // Cosmic star particles
      for (let i = 0; i < 60; i++) {
        const angle = Math.random() * Math.PI * 2
        const speed = 5 + Math.random() * 8
        particles.push({
          x: targetX + (Math.random() - 0.5) * 120,
          y: targetY + (Math.random() - 0.5) * 120,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 2 + Math.random() * 4,
          color: Math.random() > 0.6 ? "#e94560" : Math.random() > 0.3 ? "#ffffff" : "#ff69b4",
          alpha: 1,
        })
      }
      // Dimensional energy rings
      for (let ring = 0; ring < 3; ring++) {
        for (let i = 0; i < 35; i++) {
          const angle = (Math.PI * 2 * i) / 35
          const speed = (4 + ring * 2) + Math.random() * 3
          particles.push({
            x: targetX,
            y: targetY,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: 4 + Math.random() * 6,
            color: ring === 0 ? "#e94560" : ring === 1 ? "#533483" : "#ff1493",
            alpha: 0.9,
          })
        }
      }
      // Void mist
      for (let i = 0; i < 20; i++) {
        particles.push({
          x: targetX + (Math.random() - 0.5) * 80,
          y: targetY + (Math.random() - 0.5) * 80,
          vx: (Math.random() - 0.5) * 2,
          vy: (Math.random() - 0.5) * 2,
          size: 45 + Math.random() * 55,
          color: "rgba(83, 52, 131, 0.5)",
          alpha: 0.65,
        })
      }
    }
    // DEFAULT - Generic powerful explosion
    else {
      for (let i = 0; i < 60; i++) {
        const angle = (Math.PI * 2 * i) / 60 + Math.random() * 0.3
        const speed = 5 + Math.random() * 10
        particles.push({
          x: targetX,
          y: targetY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 4,
          size: 5 + Math.random() * 12,
          color: colors[Math.floor(Math.random() * colors.length)],
          alpha: 1,
        })
      }
      // White core
      for (let i = 0; i < 20; i++) {
        const angle = Math.random() * Math.PI * 2
        const speed = 2 + Math.random() * 4
        particles.push({
          x: targetX,
          y: targetY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 15 + Math.random() * 25,
          color: "#ffffff",
          alpha: 0.8,
        })
      }
      // Sparks
      for (let i = 0; i < 30; i++) {
        const angle = Math.random() * Math.PI * 2
        const speed = 8 + Math.random() * 8
        particles.push({
          x: targetX,
          y: targetY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 4,
          size: 2 + Math.random() * 4,
          color: "#ffffff",
          alpha: 1,
        })
      }
    }

    const effectId = `explosion-${Date.now()}`
    const startTime = Date.now()
    setExplosionEffects((prev) => [...prev, { id: effectId, x: targetX, y: targetY, element, particles, startTime }])

    // Trigger impact flash based on element
    const flashColors: Record<string, string> = {
      aquos: "rgba(0, 191, 255, 0.4)",
      aquo: "rgba(0, 191, 255, 0.4)",
      fire: "rgba(255, 100, 0, 0.5)",
      pyrus: "rgba(255, 100, 0, 0.5)",
      ventus: "rgba(50, 205, 50, 0.35)",
      darkness: "rgba(128, 0, 128, 0.45)",
      darkus: "rgba(128, 0, 128, 0.45)",
      dark: "rgba(128, 0, 128, 0.45)",
      lightness: "rgba(255, 255, 200, 0.5)",
      haos: "rgba(255, 255, 200, 0.5)",
      light: "rgba(255, 255, 200, 0.5)",
      void: "rgba(233, 69, 96, 0.45)",
    }
    setImpactFlash({ active: true, color: flashColors[el] || "rgba(255, 255, 255, 0.3)" })
    setTimeout(() => setImpactFlash({ active: false, color: "#ffffff" }), 200)

    setTimeout(() => {
      setExplosionEffects((prev) => prev.filter((e) => e.id !== effectId))
    }, 3000)
  }, [])

  useEffect(() => {
    // Add new effects to the ref (only new ones that don't exist yet)
    for (const effect of explosionEffects) {
      if (!activeParticlesRef.current.has(effect.id)) {
        activeParticlesRef.current.set(effect.id, {
          particles: effect.particles.map((p) => ({ ...p })),
          startTime: effect.startTime,
          element: effect.element,
          x: effect.x,
          y: effect.y,
        })
      }
    }

    // Remove effects that are no longer in the state
    const currentIds = new Set(explosionEffects.map((e) => e.id))
    for (const id of activeParticlesRef.current.keys()) {
      if (!currentIds.has(id)) {
        activeParticlesRef.current.delete(id)
      }
    }

    if (activeParticlesRef.current.size === 0) return

    const canvas = explosionCanvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    let animationId: number
    const duration = 2600 // Animation duration in ms for epic element effects

    const animate = () => {
      const now = Date.now()
      const activeEffects = activeParticlesRef.current
      
      // Check if no effects
      if (activeEffects.size === 0) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        return
      }
      
      // Get effects as array for iteration
      const localEffects = Array.from(activeEffects.entries())
      
      // Check if all effects are done
      const allDone = localEffects.every(([, effect]) => now - effect.startTime > duration)
      if (allDone) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        return
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      localEffects.forEach(([effectId, effect]) => {
        const elapsed = now - effect.startTime
        
        // Skip if this effect is done
        if (elapsed > duration) return
        
        const colors = getElementColors(effect.element)
        const el = effect.element?.toLowerCase()

        // ELEMENT-SPECIFIC EPIC EFFECTS
        
        // AQUO/AQUOS - Water ripple waves
        if (el === "aquos" || el === "aquo") {
          // Multiple expanding water ripples
          for (let ring = 0; ring < 4; ring++) {
            const ringProgress = Math.min(1, (elapsed - ring * 80) / 500)
            if (ringProgress > 0 && ringProgress < 1) {
              const ringRadius = ringProgress * 180
              const ringAlpha = (1 - ringProgress) * 0.5
              ctx.save()
              ctx.globalAlpha = ringAlpha
              ctx.strokeStyle = ring % 2 === 0 ? "#00bfff" : "#40e0d0"
              ctx.lineWidth = 3 * (1 - ringProgress)
              ctx.shadowColor = "#00ffff"
              ctx.shadowBlur = 15
              ctx.beginPath()
              ctx.arc(effect.x, effect.y, ringRadius, 0, Math.PI * 2)
              ctx.stroke()
              ctx.restore()
            }
          }
          // Water splash central glow
          const splashAlpha = Math.max(0, 1 - elapsed / 300)
          if (splashAlpha > 0) {
            const gradient = ctx.createRadialGradient(effect.x, effect.y, 0, effect.x, effect.y, 80)
            gradient.addColorStop(0, `rgba(0, 255, 255, ${splashAlpha * 0.8})`)
            gradient.addColorStop(0.5, `rgba(0, 191, 255, ${splashAlpha * 0.4})`)
            gradient.addColorStop(1, "transparent")
            ctx.fillStyle = gradient
            ctx.fillRect(effect.x - 80, effect.y - 80, 160, 160)
          }
        }
        // FIRE/PYRUS - Intense flame burst
        else if (el === "fire" || el === "pyrus") {
          // Fire shockwave
          const fireProgress = Math.min(1, elapsed / 350)
          if (fireProgress < 1) {
            const ringRadius = fireProgress * 160
            ctx.save()
            ctx.globalAlpha = (1 - fireProgress) * 0.7
            ctx.strokeStyle = "#ff6600"
            ctx.lineWidth = 6 * (1 - fireProgress)
            ctx.shadowColor = "#ff4500"
            ctx.shadowBlur = 30
            ctx.beginPath()
            ctx.arc(effect.x, effect.y, ringRadius, 0, Math.PI * 2)
            ctx.stroke()
            ctx.restore()
          }
          // Intense fire core glow
          const fireAlpha = Math.max(0, 1 - elapsed / 250)
          if (fireAlpha > 0) {
            const gradient = ctx.createRadialGradient(effect.x, effect.y, 0, effect.x, effect.y, 100)
            gradient.addColorStop(0, `rgba(255, 255, 200, ${fireAlpha})`)
            gradient.addColorStop(0.3, `rgba(255, 140, 0, ${fireAlpha * 0.8})`)
            gradient.addColorStop(0.6, `rgba(255, 69, 0, ${fireAlpha * 0.5})`)
            gradient.addColorStop(1, "transparent")
            ctx.fillStyle = gradient
            ctx.fillRect(effect.x - 100, effect.y - 100, 200, 200)
          }
          // Heat distortion lines
          for (let i = 0; i < 8; i++) {
            const lineAngle = (Math.PI * 2 * i) / 8
            const lineProgress = Math.min(1, elapsed / 400)
            if (lineProgress < 1) {
              ctx.save()
              ctx.globalAlpha = (1 - lineProgress) * 0.6
              ctx.strokeStyle = "#ffcc00"
              ctx.lineWidth = 2
              ctx.shadowColor = "#ff6600"
              ctx.shadowBlur = 10
              ctx.beginPath()
              ctx.moveTo(effect.x, effect.y)
              ctx.lineTo(
                effect.x + Math.cos(lineAngle) * lineProgress * 120,
                effect.y + Math.sin(lineAngle) * lineProgress * 120
              )
              ctx.stroke()
              ctx.restore()
            }
          }
        }
        // VENTUS - Swirling wind vortex
        else if (el === "ventus") {
          // Spiral wind effect
          const spiralProgress = Math.min(1, elapsed / 600)
          if (spiralProgress < 1) {
            ctx.save()
            ctx.globalAlpha = (1 - spiralProgress) * 0.6
            ctx.strokeStyle = "#32cd32"
            ctx.lineWidth = 2
            ctx.shadowColor = "#00ff00"
            ctx.shadowBlur = 15
            ctx.beginPath()
            for (let angle = 0; angle < Math.PI * 6; angle += 0.1) {
              const radius = angle * 8 * spiralProgress
              const x = effect.x + Math.cos(angle + elapsed * 0.01) * radius
              const y = effect.y + Math.sin(angle + elapsed * 0.01) * radius
              if (angle === 0) ctx.moveTo(x, y)
              else ctx.lineTo(x, y)
            }
            ctx.stroke()
            ctx.restore()
          }
          // Wind gusts
          for (let i = 0; i < 6; i++) {
            const gustAngle = (Math.PI * 2 * i) / 6 + elapsed * 0.005
            const gustProgress = Math.min(1, (elapsed - i * 50) / 400)
            if (gustProgress > 0 && gustProgress < 1) {
              ctx.save()
              ctx.globalAlpha = (1 - gustProgress) * 0.5
              ctx.strokeStyle = "#7cfc00"
              ctx.lineWidth = 3
              ctx.beginPath()
              ctx.moveTo(effect.x, effect.y)
              const endX = effect.x + Math.cos(gustAngle) * gustProgress * 140
              const endY = effect.y + Math.sin(gustAngle) * gustProgress * 140
              ctx.quadraticCurveTo(
                effect.x + Math.cos(gustAngle + 0.5) * gustProgress * 70,
                effect.y + Math.sin(gustAngle + 0.5) * gustProgress * 70,
                endX, endY
              )
              ctx.stroke()
              ctx.restore()
            }
          }
        }
        // DARK/DARKNESS - Shadow tendrils and void
        else if (el === "darkness" || el === "darkus" || el === "dark") {
          // Dark void core - pulsing darkness
          const voidPulse = Math.sin(elapsed * 0.02) * 0.3 + 0.7
          const voidAlpha = Math.max(0, 1 - elapsed / 800) * voidPulse
          if (voidAlpha > 0) {
            const gradient = ctx.createRadialGradient(effect.x, effect.y, 0, effect.x, effect.y, 90)
            gradient.addColorStop(0, `rgba(20, 0, 40, ${voidAlpha})`)
            gradient.addColorStop(0.5, `rgba(75, 0, 130, ${voidAlpha * 0.6})`)
            gradient.addColorStop(1, "transparent")
            ctx.fillStyle = gradient
            ctx.fillRect(effect.x - 90, effect.y - 90, 180, 180)
          }
          // Shadow tendrils extending
          for (let i = 0; i < 8; i++) {
            const tendrilAngle = (Math.PI * 2 * i) / 8
            const tendrilProgress = Math.min(1, elapsed / 500)
            if (tendrilProgress < 1) {
              ctx.save()
              ctx.globalAlpha = (1 - tendrilProgress) * 0.7
              ctx.strokeStyle = "#9932cc"
              ctx.lineWidth = 4 * (1 - tendrilProgress * 0.5)
              ctx.shadowColor = "#800080"
              ctx.shadowBlur = 20
              ctx.beginPath()
              ctx.moveTo(effect.x, effect.y)
              // Wavy tendril
              const segments = 5
              for (let s = 1; s <= segments; s++) {
                const segProgress = s / segments
                const wave = Math.sin(s * 2 + elapsed * 0.01) * 15
                ctx.lineTo(
                  effect.x + Math.cos(tendrilAngle) * tendrilProgress * 100 * segProgress + Math.cos(tendrilAngle + Math.PI / 2) * wave,
                  effect.y + Math.sin(tendrilAngle) * tendrilProgress * 100 * segProgress + Math.sin(tendrilAngle + Math.PI / 2) * wave
                )
              }
              ctx.stroke()
              ctx.restore()
            }
          }
          // Purple lightning
          if (elapsed < 400 && Math.random() > 0.7) {
            ctx.save()
            ctx.globalAlpha = 0.8
            ctx.strokeStyle = "#da70d6"
            ctx.lineWidth = 2
            ctx.shadowColor = "#9932cc"
            ctx.shadowBlur = 15
            const startAngle = Math.random() * Math.PI * 2
            ctx.beginPath()
            ctx.moveTo(effect.x, effect.y)
            let lx = effect.x, ly = effect.y
            for (let j = 0; j < 5; j++) {
              lx += Math.cos(startAngle) * 20 + (Math.random() - 0.5) * 30
              ly += Math.sin(startAngle) * 20 + (Math.random() - 0.5) * 30
              ctx.lineTo(lx, ly)
            }
            ctx.stroke()
            ctx.restore()
          }
        }
        // LIGHT/LIGHTNESS - Divine radiance
        else if (el === "lightness" || el === "haos" || el === "light") {
          // Brilliant flash
          const flashAlpha = Math.max(0, 1 - elapsed / 200)
          if (flashAlpha > 0) {
            ctx.save()
            ctx.globalAlpha = flashAlpha
            ctx.fillStyle = "#ffffff"
            ctx.shadowColor = "#ffd700"
            ctx.shadowBlur = 60
            ctx.beginPath()
            ctx.arc(effect.x, effect.y, 50 * (1 - elapsed / 300), 0, Math.PI * 2)
            ctx.fill()
            ctx.restore()
          }
          // Divine rays
          for (let i = 0; i < 12; i++) {
            const rayAngle = (Math.PI * 2 * i) / 12
            const rayProgress = Math.min(1, elapsed / 450)
            if (rayProgress < 1) {
              ctx.save()
              ctx.globalAlpha = (1 - rayProgress) * 0.6
              ctx.strokeStyle = i % 2 === 0 ? "#ffd700" : "#ffffff"
              ctx.lineWidth = 4 * (1 - rayProgress)
              ctx.shadowColor = "#ffff00"
              ctx.shadowBlur = 20
              ctx.beginPath()
              ctx.moveTo(effect.x, effect.y)
              ctx.lineTo(
                effect.x + Math.cos(rayAngle) * rayProgress * 150,
                effect.y + Math.sin(rayAngle) * rayProgress * 150
              )
              ctx.stroke()
              ctx.restore()
            }
          }
          // Holy aura
          const auraAlpha = Math.max(0, 1 - elapsed / 600)
          if (auraAlpha > 0) {
            const gradient = ctx.createRadialGradient(effect.x, effect.y, 0, effect.x, effect.y, 130)
            gradient.addColorStop(0, `rgba(255, 255, 255, ${auraAlpha * 0.9})`)
            gradient.addColorStop(0.4, `rgba(255, 215, 0, ${auraAlpha * 0.5})`)
            gradient.addColorStop(0.7, `rgba(255, 255, 200, ${auraAlpha * 0.2})`)
            gradient.addColorStop(1, "transparent")
            ctx.fillStyle = gradient
            ctx.fillRect(effect.x - 130, effect.y - 130, 260, 260)
          }
        }
        // VOID - Reality distortion
        else if (el === "void") {
          // Void rift - distorted space
          const riftProgress = Math.min(1, elapsed / 600)
          if (riftProgress < 1) {
            // Multiple distortion rings
            for (let ring = 0; ring < 3; ring++) {
              const ringOff = ring * 100
              const rp = Math.min(1, (elapsed - ringOff) / 500)
              if (rp > 0 && rp < 1) {
                ctx.save()
                ctx.globalAlpha = (1 - rp) * 0.6
                ctx.strokeStyle = ring === 0 ? "#e94560" : ring === 1 ? "#533483" : "#0f3460"
                ctx.lineWidth = 3
                ctx.shadowColor = "#e94560"
                ctx.shadowBlur = 15
                ctx.setLineDash([5, 5])
                ctx.beginPath()
                ctx.arc(effect.x, effect.y, rp * 140, 0, Math.PI * 2)
                ctx.stroke()
                ctx.restore()
              }
            }
          }
          // Cosmic cracks
          for (let i = 0; i < 6; i++) {
            const crackAngle = (Math.PI * 2 * i) / 6
            const crackProgress = Math.min(1, elapsed / 400)
            if (crackProgress < 1) {
              ctx.save()
              ctx.globalAlpha = (1 - crackProgress) * 0.8
              ctx.strokeStyle = "#e94560"
              ctx.lineWidth = 2
              ctx.shadowColor = "#e94560"
              ctx.shadowBlur = 10
              ctx.beginPath()
              ctx.moveTo(effect.x, effect.y)
              let cx = effect.x, cy = effect.y
              for (let j = 0; j < 6; j++) {
                cx += Math.cos(crackAngle + (Math.random() - 0.5) * 0.8) * 20
                cy += Math.sin(crackAngle + (Math.random() - 0.5) * 0.8) * 20
                ctx.lineTo(cx, cy)
              }
              ctx.stroke()
              ctx.restore()
            }
          }
          // Dark core
          const coreAlpha = Math.max(0, 1 - elapsed / 700)
          if (coreAlpha > 0) {
            const gradient = ctx.createRadialGradient(effect.x, effect.y, 0, effect.x, effect.y, 80)
            gradient.addColorStop(0, `rgba(10, 10, 30, ${coreAlpha})`)
            gradient.addColorStop(0.5, `rgba(83, 52, 131, ${coreAlpha * 0.5})`)
            gradient.addColorStop(1, "transparent")
            ctx.fillStyle = gradient
            ctx.fillRect(effect.x - 80, effect.y - 80, 160, 160)
          }
        }
        // DEFAULT - Generic epic shockwave
        else {
          const shockwaveProgress = Math.min(1, elapsed / 400)
          if (shockwaveProgress < 1) {
            const ringRadius = shockwaveProgress * 150
            const ringAlpha = (1 - shockwaveProgress) * 0.6
            ctx.save()
            ctx.globalAlpha = ringAlpha
            ctx.strokeStyle = colors[0]
            ctx.lineWidth = 4 * (1 - shockwaveProgress)
            ctx.shadowColor = colors[0]
            ctx.shadowBlur = 20
            ctx.beginPath()
            ctx.arc(effect.x, effect.y, ringRadius, 0, Math.PI * 2)
            ctx.stroke()
            ctx.restore()
          }
          const flashAlpha = Math.max(0, 1 - elapsed / 150)
          if (flashAlpha > 0) {
            ctx.save()
            ctx.globalAlpha = flashAlpha * 0.8
            ctx.fillStyle = "#ffffff"
            ctx.shadowColor = colors[0]
            ctx.shadowBlur = 50
            ctx.beginPath()
            ctx.arc(effect.x, effect.y, 30 * (1 - elapsed / 200), 0, Math.PI * 2)
            ctx.fill()
            ctx.restore()
          }
        }

        // Draw all particles with enhanced rendering
        effect.particles.forEach((p) => {
          // Element-specific physics
          if (el === "aquos" || el === "aquo") {
            p.vy += 0.08 // Lighter gravity for water
            p.vx *= 0.97
          } else if (el === "fire" || el === "pyrus") {
            p.vy -= 0.02 // Fire rises
            p.vy += 0.05
            p.vx *= 0.96
          } else if (el === "ventus") {
            p.vx *= 0.99 // Wind carries longer
            p.vy += 0.03
          } else if (el === "darkness" || el === "darkus" || el === "dark") {
            p.vy += 0.05 // Slow floating
            p.vx *= 0.98
          } else if (el === "lightness" || el === "haos" || el === "light") {
            p.vy += 0.02 // Very light, floaty
            p.vx *= 0.995
          } else if (el === "void") {
            // Erratic movement
            p.vx += (Math.random() - 0.5) * 0.3
            p.vy += (Math.random() - 0.5) * 0.3
            p.vy += 0.04
          } else {
            p.vy += 0.12
            p.vx *= 0.98
          }

          p.x += p.vx
          p.y += p.vy
          p.alpha -= 0.012
          p.size *= 0.97

          if (p.alpha > 0 && p.size > 0.5) {
            ctx.save()
            ctx.globalAlpha = Math.max(0, p.alpha)
            ctx.fillStyle = p.color
            ctx.shadowColor = p.color
            ctx.shadowBlur = p.size > 10 ? 30 : 15
            ctx.beginPath()
            ctx.arc(p.x, p.y, Math.max(0.1, p.size), 0, Math.PI * 2)
            ctx.fill()
            ctx.restore()
          }
        })

        // Central glow for all elements
        const glowAlpha = Math.max(0, 1 - elapsed / 700)
        if (glowAlpha > 0) {
          const gradient = ctx.createRadialGradient(effect.x, effect.y, 0, effect.x, effect.y, 140)
          gradient.addColorStop(0, getElementGlow(effect.element).replace("0.8", String(glowAlpha * 0.6)))
          gradient.addColorStop(0.5, getElementGlow(effect.element).replace("0.8", String(glowAlpha * 0.25)))
          gradient.addColorStop(1, "transparent")
          ctx.fillStyle = gradient
          ctx.fillRect(effect.x - 140, effect.y - 140, 280, 280)
        }
      })

      animationId = requestAnimationFrame(animate)
    }

    animationId = requestAnimationFrame(animate)

    return () => {
      if (animationId) cancelAnimationFrame(animationId)
    }
  }, [explosionEffects]) // Dependency array includes explosionEffects to re-run when effects are added/removed

  const canPlayerAttack = () => {
    if (phase !== "battle") return false
    if (!isPlayerTurn) return false
    if (playerWentFirst) {
      return turn >= 3
    } else {
      return turn >= 2
    }
  }

  const isUltimateCard = (card: GameCard) => {
    return (
      card.type === "ultimateGear" ||
      card.type === "ultimateGuardian"
    )
  }

  const isUnitCard = (card: GameCard) => {
    return (
      card.type === "unit" ||
      card.type === "ultimateGear" ||
      card.type === "ultimateElemental" ||
      card.type === "ultimateGuardian" ||
      card.type === "troops"
    )
  }

  const canUnitAttackNow = (card: FieldCard | null): boolean => {
    if (!card) return false
    if (phase !== "battle") return false
    if (!isPlayerTurn) return false
    if (card.hasAttacked) return false
    // Only check turn restriction
    if (turn <= card.canAttackTurn) return false
    return true
  }

  const cacheEnemyRects = useCallback(() => {
    const enemyUnitElements = document.querySelectorAll("[data-enemy-unit]")
    enemyUnitRectsRef.current = Array.from(enemyUnitElements).map((el) => el.getBoundingClientRect())
  }, [])

  const startGame = (deck: DeckWithImages) => {
    setSelectedDeck(deck)

    const playerFirst = Math.random() > 0.5
    setPlayerWentFirst(playerFirst)

    const shuffledDeck = [...deck.cards].sort(() => Math.random() - 0.5)
    const hand = shuffledDeck.slice(0, 5)
    const remainingDeck = shuffledDeck.slice(5)

    setPlayerField((prev) => ({
      ...prev,
      hand,
      deck: remainingDeck,
      life: 20,
      unitZone: [null, null, null, null],
      functionZone: [null, null, null, null],
      scenarioZone: null,
    ultimateZone: null,
      graveyard: [],
    }))

    const botDeck = [...deck.cards].sort(() => Math.random() - 0.5)
    const botHand = botDeck.slice(0, 5)
    const botRemaining = botDeck.slice(5)

    setEnemyField((prev) => ({
      ...prev,
      hand: botHand,
      deck: botRemaining,
      life: 20,
      unitZone: [null, null, null, null],
      functionZone: [null, null, null, null],
      scenarioZone: null,
    ultimateZone: null,
      graveyard: [],
    }))

    setGameStarted(true)
    setTurn(1)
    setPhase("draw")
    setIsPlayerTurn(playerFirst)

    if (!playerFirst) {
      setTimeout(() => executeBotTurn(), 1000)
    }
  }

  const drawCard = () => {
  if (playerField.deck.length === 0) return
  
  const drawnCard = playerField.deck[0]
  showDrawAnimation(drawnCard)
  setPlayerField((prev) => ({
  ...prev,
  hand: [...prev.hand, drawnCard],
  deck: prev.deck.slice(1),
  }))
  }

  const placeCard = (zone: "unit" | "function", slotIndex: number, forcedCardIndex?: number) => {
    if (!isPlayerTurn) return
    if (phase !== "main") return

    const cardIndex = forcedCardIndex ?? (draggedHandCard?.index ?? selectedHandCard)
    if (cardIndex === null || cardIndex === undefined) return
    
    const cardToPlace = playerField.hand[cardIndex]
    if (!cardToPlace) return

    // Scenario cards can ONLY be played in the Scenario zone
    if (cardToPlace.type === "scenario") return

    // Ultimate cards (ultimateGear, ultimateGuardian) can ONLY be played in the Ultimate zone
    if (isUltimateCard(cardToPlace)) return

    const isUnit = isUnitCard(cardToPlace)
    if (zone === "unit" && isUnit) {
      if (playerField.unitZone[slotIndex] !== null) return

      const fieldCard: FieldCard = {
        ...cardToPlace,
        currentDp: cardToPlace.dp,
        canAttack: false,
        hasAttacked: false,
        canAttackTurn: turn, // Store current turn when card is placed
      }

      setPlayerField((prev) => {
        const newUnitZone = [...prev.unitZone]
        newUnitZone[slotIndex] = fieldCard
        return {
          ...prev,
          unitZone: newUnitZone,
          hand: prev.hand.filter((_, i) => i !== cardIndex),
        }
      })
    } else if (zone === "function") {
      if (playerField.functionZone[slotIndex] !== null) return

      // Get the effect configuration for this card
      const effect = getFunctionCardEffect(cardToPlace)
      
      // Special handling for Function cards by name (backup)
      const isAmplificador = cardToPlace.name === "Amplificador de Poder"
      const isBandagem = cardToPlace.name === "Bandagem Restauradora"
      const isAdaga = cardToPlace.name === "Adaga Energizada"
      const isBandagensDuplas = cardToPlace.name === "Bandagens Duplas"
      const isCristalRecuperador = cardToPlace.name === "Cristal Recuperador"
      const isCaudaDeDragao = cardToPlace.name === "Cauda de Dragão Assada"
      const isProjetilDeImpacto = cardToPlace.name === "Projétil de Impacto"
      const isVeuDosLacos = cardToPlace.name === "Véu dos Laços Cruzados"
      const isNucleoExplosivo = cardToPlace.name === "Núcleo Explosivo"
      const isKitMedico = cardToPlace.name === "Kit Médico Improvisado"
      const isSoroRecuperador = cardToPlace.name === "Soro Recuperador"
      const isOrdemDeLaceracao = cardToPlace.name === "Ordem de Laceração"
      const isSinfoniaRelampago = cardToPlace.name === "Sinfonia Relâmpago"
      const isFafnisbani = cardToPlace.name === "Fafnisbani"
      const isDevorarOMundo = cardToPlace.name === "Devorar o Mundo"
      
      if (effect || isAmplificador || isBandagem || isAdaga || isBandagensDuplas || isCristalRecuperador || isCaudaDeDragao || isProjetilDeImpacto || isVeuDosLacos || isNucleoExplosivo || isKitMedico || isSoroRecuperador || isOrdemDeLaceracao || isSinfoniaRelampago || isFafnisbani || isDevorarOMundo) {
      // Use found effect or fallback to the correct one by name
      let effectToUse = effect
      if (!effectToUse) {
      if (isAmplificador) effectToUse = FUNCTION_CARD_EFFECTS["amplificador-de-poder"]
      else if (isBandagem) effectToUse = FUNCTION_CARD_EFFECTS["bandagem-restauradora"]
      else if (isAdaga) effectToUse = FUNCTION_CARD_EFFECTS["adaga-energizada"]
          else if (isBandagensDuplas) effectToUse = FUNCTION_CARD_EFFECTS["bandagens-duplas"]
          else if (isCristalRecuperador) effectToUse = FUNCTION_CARD_EFFECTS["cristal-recuperador"]
      else if (isCaudaDeDragao) effectToUse = FUNCTION_CARD_EFFECTS["cauda-de-dragao-assada"]
      else if (isProjetilDeImpacto) effectToUse = FUNCTION_CARD_EFFECTS["projetil-de-impacto"]
      else if (isVeuDosLacos) effectToUse = FUNCTION_CARD_EFFECTS["veu-dos-lacos-cruzados"]
      else if (isNucleoExplosivo) effectToUse = FUNCTION_CARD_EFFECTS["nucleo-explosivo"]
      else if (isKitMedico) effectToUse = FUNCTION_CARD_EFFECTS["kit-medico-improvisado"]
      else if (isSoroRecuperador) effectToUse = FUNCTION_CARD_EFFECTS["soro-recuperador"]
      else if (isOrdemDeLaceracao) effectToUse = FUNCTION_CARD_EFFECTS["ordem-de-laceracao"]
      else if (isSinfoniaRelampago) effectToUse = FUNCTION_CARD_EFFECTS["sinfonia-relampago"]
      else if (isFafnisbani) effectToUse = FUNCTION_CARD_EFFECTS["fafnisbani"]
      else if (isDevorarOMundo) effectToUse = FUNCTION_CARD_EFFECTS["devorar-o-mundo"]
      }
      
      if (!effectToUse) return // Safety check
        
        // Create effect context
        const effectContext: EffectContext = {
          playerField,
          enemyField,
          setPlayerField,
          setEnemyField,
        }
        
        // Check if card can be activated
        const { canActivate, reason } = effectToUse.canActivate(effectContext)
        if (!canActivate) {
          // Card cannot be activated - show feedback
          showEffectFeedback(`${cardToPlace.name}: ${reason}`, "error")
          return // Card cannot be played
        }
        
  // If effect requires a choice first, show choice modal
  if (effectToUse.requiresChoice && effectToUse.choiceOptions) {
  setChoiceModal({
  visible: true,
  cardName: cardToPlace.name,
  options: effectToUse.choiceOptions,
  onChoose: (optionId: string) => {
  setChoiceModal(null)
  
  // For Fafnisbani and Devorar o Mundo - if choosing LP, resolve immediately
  if (optionId === "lp") {
    const result = effectToUse.resolve(effectContext, { chosenOption: "lp" })
    if (result.success) {
      showEffectFeedback(`${cardToPlace.name}: ${result.message}`, "success")
      setPlayerField((prev) => ({
        ...prev,
        hand: prev.hand.filter((_, i) => i !== cardIndex),
        graveyard: [...prev.graveyard, cardToPlace],
      }))
    } else {
      showEffectFeedback(`${cardToPlace.name}: ${result.message || "Falha"}`, "error")
    }
    setSelectedHandCard(null)
    setDraggedHandCard(null)
    return
  }
  
  // Now enter target selection mode with the chosen option
  const step = optionId === "buff" ? "selectAlly" : "selectEnemy"
  setItemSelectionMode({
  active: true,
  itemCard: cardToPlace,
  step: step,
  selectedEnemyIndex: null,
  chosenOption: optionId,
  })
  setPlayerField((prev) => ({
  ...prev,
  hand: prev.hand.filter((_, i) => i !== cardIndex),
  }))
  setSelectedHandCard(null)
  setDraggedHandCard(null)
  },
  })
  return
  }
  
  // If effect requires targets, enter selection mode
  if (effectToUse.requiresTargets && effectToUse.targetConfig) {
  // Determine the correct step based on target config
  // If only needs ally units (like dice cards), go straight to selectAlly
  const needsEnemyFirst = effectToUse.targetConfig.enemyUnits && effectToUse.targetConfig.enemyUnits > 0
  const initialStep = needsEnemyFirst ? "selectEnemy" : "selectAlly"
  
  setItemSelectionMode({
  active: true,
  itemCard: cardToPlace,
  step: initialStep,
  selectedEnemyIndex: null,
  chosenOption: null,
  })
  setPlayerField((prev) => ({
  ...prev,
  hand: prev.hand.filter((_, i) => i !== cardIndex),
  }))
  setSelectedHandCard(null)
  setDraggedHandCard(null)
  return
  }
        
        // Effect doesn't require targets - resolve immediately
        const result = effectToUse.resolve(effectContext)
        if (result.success) {
          // Show visual feedback
          showEffectFeedback(`${cardToPlace.name}: ${result.message}`, "success")
          
          // Special handling for Cristal Recuperador - draw a card and check if Function type
          if (result.needsDrawAndCheck) {
            setTimeout(() => {
              setPlayerField((prev) => {
                if (prev.deck.length === 0) {
                  showEffectFeedback("Deck vazio - nao pode comprar carta", "error")
                  return {
                    ...prev,
                    hand: prev.hand.filter((_, i) => i !== cardIndex),
                    graveyard: [...prev.graveyard, cardToPlace],
                  }
                }
                
                const drawnCard = prev.deck[0]
                const newDeck = prev.deck.slice(1)
                const newHand = [...prev.hand.filter((_, i) => i !== cardIndex), drawnCard]
                
                // Check if drawn card is a Function type (item)
                const isFunctionCard = drawnCard.type === "item"
                let finalLife = result.currentLife || prev.life
                
                if (isFunctionCard) {
                  const maxLife = 20
                  const bonusHeal = Math.min(1, maxLife - finalLife)
                  finalLife = Math.min(finalLife + bonusHeal, maxLife)
                  if (bonusHeal > 0) {
                    showEffectFeedback(`Carta Function comprada! +1 LP bonus! (${finalLife - 1} -> ${finalLife})`, "success")
                  }
                } else {
                  showEffectFeedback(`Comprou: ${drawnCard.name}`, "success")
                }
                
                return {
                  ...prev,
                  deck: newDeck,
                  hand: newHand,
                  graveyard: [...prev.graveyard, cardToPlace],
                  life: finalLife,
                }
              })
            }, 500) // Small delay for visual feedback
            
            setSelectedHandCard(null)
            setDraggedHandCard(null)
            return
          }
          
          // Special handling for Kit Médico Improvisado - draw and check if Unit type for bonus
          if (result.needsDrawAndCheckUnit) {
            setTimeout(() => {
              setPlayerField((prev) => {
                if (prev.deck.length === 0) {
                  showEffectFeedback("Deck vazio - nao pode comprar carta", "error")
                  return {
                    ...prev,
                    hand: prev.hand.filter((_, i) => i !== cardIndex),
                    graveyard: [...prev.graveyard, cardToPlace],
                  }
                }
                
                const drawnCard = prev.deck[0]
                const newDeck = prev.deck.slice(1)
                const newHand = [...prev.hand.filter((_, i) => i !== cardIndex), drawnCard]
                
                // Check if drawn card is a Unit type
                const isUnitCard = drawnCard.type === "unit"
                let finalLife = result.currentLife || prev.life
                
                if (isUnitCard) {
                  const maxLife = 20
                  const bonusHeal = Math.min(1, maxLife - finalLife)
                  finalLife = Math.min(finalLife + bonusHeal, maxLife)
                  if (bonusHeal > 0) {
                    showEffectFeedback(`Carta Unidade comprada! +1 LP bonus! (${finalLife - 1} -> ${finalLife})`, "success")
                  }
                } else {
                  showEffectFeedback(`Comprou: ${drawnCard.name}`, "success")
                }
                
                return {
                  ...prev,
                  deck: newDeck,
                  hand: newHand,
                  graveyard: [...prev.graveyard, cardToPlace],
                  life: finalLife,
                }
              })
            }, 500)
            
            setSelectedHandCard(null)
            setDraggedHandCard(null)
            return
          }
          
          // Special handling for Soro Recuperador - just draw, no bonus check
          if (result.needsDrawOnly) {
            setTimeout(() => {
              setPlayerField((prev) => {
                if (prev.deck.length === 0) {
                  showEffectFeedback("Deck vazio - nao pode comprar carta", "error")
                  return {
                    ...prev,
                    hand: prev.hand.filter((_, i) => i !== cardIndex),
                    graveyard: [...prev.graveyard, cardToPlace],
                  }
                }
                
                const drawnCard = prev.deck[0]
                const newDeck = prev.deck.slice(1)
                const newHand = [...prev.hand.filter((_, i) => i !== cardIndex), drawnCard]
                
                showEffectFeedback(`Comprou: ${drawnCard.name}`, "success")
                
                return {
                  ...prev,
                  deck: newDeck,
                  hand: newHand,
                  graveyard: [...prev.graveyard, cardToPlace],
                }
              })
            }, 500)
            
            setSelectedHandCard(null)
            setDraggedHandCard(null)
            return
          }
          
          // Send card to graveyard after resolution
          setPlayerField((prev) => ({
            ...prev,
            hand: prev.hand.filter((_, i) => i !== cardIndex),
            graveyard: [...prev.graveyard, cardToPlace],
          }))
          setSelectedHandCard(null)
          setDraggedHandCard(null)
          return
        } else {
          showEffectFeedback(`${cardToPlace.name}: ${result.message || "Falha ao ativar"}`, "error")
        }
      }

      // Fallback: place card in function zone without effect
      setPlayerField((prev) => {
        const newFunctionZone = [...prev.functionZone]
        newFunctionZone[slotIndex] = cardToPlace
        return {
          ...prev,
          functionZone: newFunctionZone,
          hand: prev.hand.filter((_, i) => i !== cardIndex),
        }
      })
    }

    setSelectedHandCard(null) // Clear selection if using drag-drop
    setDraggedHandCard(null) // Clear drag state
  }

  const placeScenarioCard = (forcedCardIndex?: number) => {
    if (!isPlayerTurn) return
    if (phase !== "main") return

    const cardIndex = forcedCardIndex ?? (draggedHandCard?.index ?? selectedHandCard)
    if (cardIndex === null || cardIndex === undefined) return
    
    const cardToPlace = playerField.hand[cardIndex]
    if (!cardToPlace || cardToPlace.type !== "scenario") return
    if (playerField.scenarioZone !== null) return

    setPlayerField((prev) => ({
      ...prev,
      scenarioZone: cardToPlace,
      hand: prev.hand.filter((_, i) => i !== cardIndex),
    }))

    setSelectedHandCard(null)
    setDraggedHandCard(null)
  }

  // Helper: find index of a unit by name in a unit zone
  const findUnitByName = (unitZone: (FieldCard | null)[], unitName: string): number => {
    return unitZone.findIndex((u) => u && u.name === unitName)
  }

  // Helper: count fire element units in graveyard + field (already used)
  const countFireUnitsUsed = (field: FieldState): number => {
    let count = 0
    // Graveyard fire units
    count += field.graveyard.filter((c) => c.element === "Pyrus" && (c.type === "unit" || c.type === "ultimateGear" || c.type === "ultimateGuardian" || c.type === "ultimateElemental")).length
    // Field fire units currently in play
    field.unitZone.forEach((u) => { if (u && u.element === "Pyrus") count++ })
    return count
  }

  const placeUltimateCard = (forcedCardIndex?: number) => {
    if (!isPlayerTurn) return
    if (phase !== "main") return

    const cardIndex = forcedCardIndex ?? (draggedHandCard?.index ?? selectedHandCard)
    if (cardIndex === null || cardIndex === undefined) return

    const cardToPlace = playerField.hand[cardIndex]
    if (!cardToPlace || !isUltimateCard(cardToPlace)) return
    if (playerField.ultimateZone !== null) return

    const fieldCard: FieldCard = {
      ...cardToPlace,
      currentDp: cardToPlace.dp,
      canAttack: false,
      hasAttacked: false,
      canAttackTurn: turn,
    }

    setPlayerField((prev) => {
      const newHand = prev.hand.filter((_, i) => i !== cardIndex)
      const requiredUnit = cardToPlace.requiresUnit
      const unitIdx = requiredUnit ? findUnitByName(prev.unitZone, requiredUnit) : -1
      const unitFound = unitIdx !== -1

      // Apply passive DP bonus to the matching unit if found
      let newUnitZone = [...prev.unitZone]
      let bonusMsg = ""

      if (unitFound && requiredUnit) {
        const unit = newUnitZone[unitIdx]!
        const ability = cardToPlace.ability

        if (ability === "ODEN SWORD") {
          // +4 DP to Fehnon
          newUnitZone[unitIdx] = { ...unit, currentDp: unit.currentDp + 4 }
          bonusMsg = `${requiredUnit} +4 DP!`
        } else if (ability === "PROTONIX SWORD") {
          // +2 DP to Fehnon
          newUnitZone[unitIdx] = { ...unit, currentDp: unit.currentDp + 2 }
          bonusMsg = `${requiredUnit} +2 DP!`
        } else if (ability === "TWILIGH AVALON") {
          // +2 DP to Morgana
          newUnitZone[unitIdx] = { ...unit, currentDp: unit.currentDp + 2 }
          bonusMsg = `${requiredUnit} +2 DP!`
        } else if (ability === "ULLRBOGI") {
          // +3 DP only during battle phase - applied separately, no immediate bonus
          bonusMsg = `${requiredUnit} recebera +3 DP nas fases de batalha!`
        } else if (ability === "FORNBRENNA") {
          // Count fire units used so far
          const fireCount = countFireUnitsUsed(prev)
          const bonus = fireCount * 2
          if (bonus > 0) {
            newUnitZone[unitIdx] = { ...unit, currentDp: unit.currentDp + bonus }
          }
          setFornbrennaFireCount(fireCount)
          bonusMsg = `${requiredUnit} +${bonus} DP! (${fireCount} unidades de fogo usadas)`
        }
      }

      if (bonusMsg) {
        setTimeout(() => showEffectFeedback(bonusMsg, "success"), 300)
      } else if (requiredUnit && !unitFound) {
        setTimeout(() => showEffectFeedback(`${cardToPlace.name} equipada! Coloque ${requiredUnit} no campo para ativar.`, "success"), 300)
      }

      return {
        ...prev,
        ultimateZone: fieldCard,
        unitZone: newUnitZone as (FieldCard | null)[],
        hand: newHand,
      }
    })

    // Reset one-time ability flag for a new UG
    setPlayerUgAbilityUsed(false)
    setSelectedHandCard(null)
    setDraggedHandCard(null)
  }

  // Activate Ultimate Gear one-time ability
  const activateUgAbility = () => {
    if (!isPlayerTurn || phase !== "main") return
    if (playerUgAbilityUsed) return
    if (!playerField.ultimateZone) return

    const ug = playerField.ultimateZone
    const requiredUnit = ug.requiresUnit
    if (!requiredUnit) return

    // Check if the required unit is on the field
    const unitIdx = findUnitByName(playerField.unitZone, requiredUnit)
    if (unitIdx === -1) {
      showEffectFeedback(`${requiredUnit} precisa estar no campo!`, "error")
      return
    }

    if (ug.ability === "ODEN SWORD") {
      // Check if opponent has function cards
      const hasEnemyFunctions = enemyField.functionZone.some((f) => f !== null)
      if (!hasEnemyFunctions) {
        showEffectFeedback("Oponente nao tem cartas de Function no campo!", "error")
        return
      }
      setUgTargetMode({ active: true, ugCard: ug, type: "oden_sword" })
      showEffectFeedback("Selecione uma Function inimiga para destruir!", "success")
    } else if (ug.ability === "TWILIGH AVALON") {
      // Check if opponent has any cards on field (units or functions)
      const hasEnemyCards = enemyField.unitZone.some((u) => u !== null) || enemyField.functionZone.some((f) => f !== null)
      if (!hasEnemyCards) {
        showEffectFeedback("Oponente nao tem cartas no campo!", "error")
        return
      }
      setUgTargetMode({ active: true, ugCard: ug, type: "twiligh_avalon" })
      showEffectFeedback("Selecione uma carta inimiga para devolver a mao!", "success")
    }
  }

  // Handle UG target selection for enemy function cards (ODEN SWORD)
  const handleUgTargetEnemyFunction = (funcIndex: number) => {
    if (!ugTargetMode.active || ugTargetMode.type !== "oden_sword") return
    const funcCard = enemyField.functionZone[funcIndex]
    if (!funcCard) return

    setEnemyField((prev) => {
      const newFuncs = [...prev.functionZone]
      const destroyed = newFuncs[funcIndex]
      newFuncs[funcIndex] = null
      return {
        ...prev,
        functionZone: newFuncs,
        graveyard: destroyed ? [...prev.graveyard, destroyed] : prev.graveyard,
      }
    })

    showEffectFeedback(`ODEN SWORD: ${funcCard.name} destruida!`, "success")
    setPlayerUgAbilityUsed(true)
    setUgTargetMode({ active: false, ugCard: null, type: null })
  }

  // Handle UG target selection for any enemy card (TWILIGH AVALON)
  const handleUgTargetEnemyCard = (type: "unit" | "function", index: number) => {
    if (!ugTargetMode.active || ugTargetMode.type !== "twiligh_avalon") return

    if (type === "unit") {
      const unit = enemyField.unitZone[index]
      if (!unit) return

      setEnemyField((prev) => {
        const newUnits = [...prev.unitZone]
        const returned = newUnits[index]
        newUnits[index] = null
        return {
          ...prev,
          unitZone: newUnits as (FieldCard | null)[],
          hand: returned ? [...prev.hand, returned] : prev.hand,
        }
      })
      // If returned card is a unit, deal 3 DP to opponent
      setEnemyField((prev) => ({
        ...prev,
        life: Math.max(0, prev.life - 3),
      }))
      showEffectFeedback(`TWILIGH AVALON: ${unit.name} devolvida! -3 LP no oponente!`, "success")
    } else {
      const func = enemyField.functionZone[index]
      if (!func) return

      setEnemyField((prev) => {
        const newFuncs = [...prev.functionZone]
        const returned = newFuncs[index]
        newFuncs[index] = null
        return {
          ...prev,
          functionZone: newFuncs,
          hand: returned ? [...prev.hand, returned] : prev.hand,
        }
      })
      showEffectFeedback(`TWILIGH AVALON: ${func.name} devolvida a mao!`, "success")
    }

    setPlayerUgAbilityUsed(true)
    setUgTargetMode({ active: false, ugCard: null, type: null })
  }

  // Cancel UG target mode
  const cancelUgTargetMode = () => {
    setUgTargetMode({ active: false, ugCard: null, type: null })
  }

  const advancePhase = () => {
  if (!isPlayerTurn) return
  if (phase === "draw") {
  // Compra uma carta automaticamente ao sair da fase de draw
  if (playerField.deck.length > 0) {
  const drawnCard = playerField.deck[0]
  showDrawAnimation(drawnCard)
  setPlayerField((prev) => ({
  ...prev,
  hand: [...prev.hand, drawnCard],
  deck: prev.deck.slice(1),
  }))
  }
  setPhase("main")
  } else if (phase === "main") {
  // ULLRBOGI: +3 DP to Ullr when entering battle phase
  if (playerField.ultimateZone && playerField.ultimateZone.ability === "ULLRBOGI" && playerField.ultimateZone.requiresUnit) {
    const ullrIdx = findUnitByName(playerField.unitZone, playerField.ultimateZone.requiresUnit)
    if (ullrIdx !== -1) {
      setPlayerField((prev) => {
        const newUnits = [...prev.unitZone]
        const unit = newUnits[ullrIdx]
        if (unit) {
          newUnits[ullrIdx] = { ...unit, currentDp: unit.currentDp + 3 }
          showEffectFeedback(`ULLRBOGI: ${unit.name} +3 DP na fase de batalha!`, "success")
        }
        return { ...prev, unitZone: newUnits as (FieldCard | null)[] }
      })
    }
  }
  setPhase("battle")
  } else if (phase === "battle") {
  // ULLRBOGI: remove +3 DP from Ullr when leaving battle phase
  if (playerField.ultimateZone && playerField.ultimateZone.ability === "ULLRBOGI" && playerField.ultimateZone.requiresUnit) {
    const ullrIdx = findUnitByName(playerField.unitZone, playerField.ultimateZone.requiresUnit)
    if (ullrIdx !== -1) {
      setPlayerField((prev) => {
        const newUnits = [...prev.unitZone]
        const unit = newUnits[ullrIdx]
        if (unit) {
          newUnits[ullrIdx] = { ...unit, currentDp: Math.max(0, unit.currentDp - 3) }
        }
        return { ...prev, unitZone: newUnits as (FieldCard | null)[] }
      })
    }
  }
  endTurn()
  }
  }

  const handleAttackStart = useCallback(
    (index: number, e: React.MouseEvent | React.TouchEvent) => {
      if (!isPlayerTurn || phase !== "battle") return

      const unit = playerField.unitZone[index]
      if (!unit || unit.hasAttacked) return
      if (turn <= unit.canAttackTurn) return

      e.preventDefault()
      e.stopPropagation()

      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY

      isDraggingRef.current = true
      positionRef.current = {
        startX: clientX,
        startY: clientY,
        currentX: clientX,
        currentY: clientY,
        lastTargetCheck: 0,
      }

      cacheEnemyRects()

      setArrowPos({ x1: clientX, y1: clientY, x2: clientX, y2: clientY })
      setAttackState({
        isAttacking: true,
        attackerIndex: index,
        targetInfo: null,
      })
    },
    [isPlayerTurn, phase, playerField.unitZone, cacheEnemyRects, turn],
  )

  const handleAttackMove = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!isDraggingRef.current || !attackState.isAttacking) return

      e.preventDefault()

      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY

      // Direct state update for immediate response
      setArrowPos((prev) => ({ ...prev, x2: clientX, y2: clientY }))

      // Throttled target detection
      const now = Date.now()
      if (!positionRef.current.lastTargetCheck || now - positionRef.current.lastTargetCheck > 50) {
        positionRef.current.lastTargetCheck = now

        const fieldRect = fieldRef.current?.getBoundingClientRect()
        if (!fieldRect) return

        const relativeY = clientY - fieldRect.top
        let foundTarget: { type: "unit" | "direct"; index?: number } | null = null

        // Check upper half for enemy units
        if (relativeY < fieldRect.height / 2) {
          for (let idx = 0; idx < enemyUnitRectsRef.current.length; idx++) {
            const rect = enemyUnitRectsRef.current[idx]
            if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
              if (enemyField.unitZone[idx]) {
                foundTarget = { type: "unit", index: idx }
                break
              }
            }
          }
          // Check for direct attack if no units
          if (!foundTarget) {
            const hasEnemyUnits = enemyField.unitZone.some((u) => u !== null)
            if (!hasEnemyUnits) {
              foundTarget = { type: "direct" }
            }
          }
        }

        setAttackState((prev) => ({ ...prev, targetInfo: foundTarget }))
      }
    },
    [attackState.isAttacking, enemyField.unitZone, setAttackState],
  )

  const handleAttackEnd = useCallback(() => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false

    if (attackState.isAttacking && attackState.attackerIndex !== null && attackState.targetInfo) {
      const attacker = playerField.unitZone[attackState.attackerIndex]
      if (attacker) {
        if (attackState.targetInfo.type === "unit" && attackState.targetInfo.index !== undefined) {
          // Attack an enemy unit
          const defender = enemyField.unitZone[attackState.targetInfo.index]
          if (defender) {
            const attackerDp = attacker.currentDp || attacker.dp
            const defenderDp = defender.currentDp || defender.dp
            const newDefenderDp = defenderDp - attackerDp
            const targetIndex = attackState.targetInfo.index

            // Get target element position for explosion
            const targetElement = document.querySelector(`[data-enemy-unit="${targetIndex}"]`)
            const targetRect = targetElement?.getBoundingClientRect()

  setEnemyField((prev) => {
  const newUnitZone = [...prev.unitZone]
  const newGraveyard = [...prev.graveyard]

  // PROTONIX SWORD protection: unit equipped with it cannot be destroyed in battle (stays at 1 DP)
  const isProtectedByProtonix = prev.ultimateZone &&
    prev.ultimateZone.ability === "PROTONIX SWORD" &&
    prev.ultimateZone.requiresUnit === defender.name

  if (newDefenderDp <= 0) {
  if (isProtectedByProtonix) {
    // Protected: stays at 1 DP instead of being destroyed
    newUnitZone[targetIndex] = { ...defender, currentDp: 1 }
    showEffectFeedback(`PROTONIX SWORD: ${defender.name} protegida! Resta 1 DP`, "error")
  } else {
    if (targetRect) {
    showDestructionAnimation(
      defender,
      targetRect.left + targetRect.width / 2,
      targetRect.top + targetRect.height / 2
    )
    setTimeout(() => {
      triggerExplosion(
      targetRect.left + targetRect.width / 2,
      targetRect.top + targetRect.height / 2,
      attacker.element || "neutral",
      )
    }, 400)
    }
    newGraveyard.push(defender)
    newUnitZone[targetIndex] = null
  }
  } else {
  newUnitZone[targetIndex] = { ...defender, currentDp: newDefenderDp }
  }
  return { ...prev, unitZone: newUnitZone, graveyard: newGraveyard }
  })

            setPlayerField((prev) => {
              const newUnitZone = [...prev.unitZone]
              newUnitZone[attackState.attackerIndex!] = { ...attacker, hasAttacked: true }
              return { ...prev, unitZone: newUnitZone }
            })
          }
        } else if (attackState.targetInfo.type === "direct") {
          // Direct attack to opponent's Life Points
          const directZone = document.querySelector("[data-direct-attack]")
          const directRect = directZone?.getBoundingClientRect()
          if (directRect) {
            triggerExplosion(
              // Use triggerExplosion instead of createExplosionEffect
              directRect.left + directRect.width / 2,
              directRect.top + directRect.height / 2,
              attacker.element || "neutral",
            )
          }

          setEnemyField((prev) => ({
            ...prev,
            life: prev.life - (attacker.currentDp || attacker.dp), // Reduce life by attacker's DP
          }))
          setPlayerField((prev) => {
            const newUnitZone = [...prev.unitZone]
            // Mark attacker as having attacked
            newUnitZone[attackState.attackerIndex!] = { ...attacker, hasAttacked: true }
            return { ...prev, unitZone: newUnitZone }
          })
        }
      }
    }

    // Reset attack state regardless of whether an attack was successful
    setAttackState({ isAttacking: false, attackerIndex: null, targetInfo: null })
  }, [attackState, playerField.unitZone, enemyField.unitZone, triggerExplosion])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [])

  const handleHandCardDragStart = (index: number, e: React.MouseEvent | React.TouchEvent) => {
    if (!isPlayerTurn || phase !== "main") return

    const card = playerField.hand[index]
    if (!card) return

    e.preventDefault()

    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY

    dragPosRef.current = { x: clientX, y: clientY, rotation: 0 }
    setDraggedHandCard({ index, card })
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
    
    // Update DOM directly for smooth movement (no React re-render)
    const isOverTarget = dropTarget !== null
    draggedCardRef.current.style.transform = `translate(${clientX - 40}px, ${clientY - 56}px) rotate(${isOverTarget ? 0 : dragPosRef.current.rotation}deg) scale(${isOverTarget ? 1.2 : 1.1})`

    // Throttled drop target check - only every 50ms
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
          if (!playerField.ultimateZone) {
            foundTarget = { type: "ultimate", index: 0 }
            break
          }
        } else if (unitSlot && isUnitCard(draggedHandCard.card) && !isUltimateCard(draggedHandCard.card)) {
          const slotIndex = Number.parseInt(unitSlot.getAttribute("data-player-unit-slot") || "0")
          if (!playerField.unitZone[slotIndex]) {
            foundTarget = { type: "unit", index: slotIndex }
            break
          }
        } else if (funcSlot && !isUnitCard(draggedHandCard.card) && draggedHandCard.card.type !== "scenario") {
          const slotIndex = Number.parseInt(funcSlot.getAttribute("data-player-func-slot") || "0")
          if (!playerField.functionZone[slotIndex]) {
            foundTarget = { type: "function", index: slotIndex }
            break
          }
        } else if (scenarioSlot && draggedHandCard.card.type === "scenario") {
          if (!playerField.scenarioZone) {
            foundTarget = { type: "scenario", index: 0 }
            break
          }
        }
      }

      // Only update state if target changed
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
      const targetSelector = dropTarget.type === "unit" 
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
      
      // Remove card from hand IMMEDIATELY by passing index directly
      if (targetType === "ultimate") {
        placeUltimateCard(cardIndex)
      } else if (targetType === "scenario") {
        placeScenarioCard(cardIndex)
      } else {
        placeCard(targetType, targetIndex, cardIndex)
      }
      setSelectedHandCard(null)
      
      // Show materialize animation if we have target position
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

  // Card inspection handlers (press and hold to view)
  const handleCardPressStart = (card: GameCard) => {
    if (cardPressTimer.current) {
      clearTimeout(cardPressTimer.current)
    }
    cardPressTimer.current = setTimeout(() => {
      setInspectedCard(card)
    }, 300) // 300ms hold to inspect
  }

  const handleCardPressEnd = () => {
    if (cardPressTimer.current) {
      clearTimeout(cardPressTimer.current)
      cardPressTimer.current = null
    }
  }

  const executeBotTurn = () => {
    if (enemyField.deck.length > 0) {
      setEnemyField((prev) => ({
        ...prev,
        hand: [...prev.hand, prev.deck[0]],
        deck: prev.deck.slice(1),
      }))
    }

    setTimeout(() => {
      setEnemyField((prev) => {
        let newHand = [...prev.hand]
        const newUnitZone = [...prev.unitZone]
        const newFunctionZone = [...prev.functionZone]
        let newScenarioZone = prev.scenarioZone
        let newUltimateZone = prev.ultimateZone

        // Bot plays Scenario cards ONLY in Scenario zone
        for (let i = newHand.length - 1; i >= 0; i--) {
          const card = newHand[i]
          if (card && card.type === "scenario" && !newScenarioZone) {
            newScenarioZone = card
            newHand.splice(i, 1)
            break // Only one scenario at a time
          }
        }

        // Bot plays Ultimate cards (ultimateGear, ultimateGuardian) ONLY in Ultimate zone
        for (let i = newHand.length - 1; i >= 0; i--) {
          const card = newHand[i]
          if (card && isUltimateCard(card) && !newUltimateZone) {
            newUltimateZone = {
              ...card,
              currentDp: card.dp,
              canAttack: false,
              hasAttacked: false,
              canAttackTurn: turn,
            }
            // Apply passive DP bonus to matching unit if present
            if (card.requiresUnit) {
              const matchIdx = newUnitZone.findIndex((u) => u && u.name === card.requiresUnit)
              if (matchIdx !== -1 && newUnitZone[matchIdx]) {
                const unit = newUnitZone[matchIdx]!
                let bonus = 0
                if (card.ability === "ODEN SWORD") bonus = 4
                else if (card.ability === "PROTONIX SWORD") bonus = 2
                else if (card.ability === "TWILIGH AVALON") bonus = 2
                else if (card.ability === "FORNBRENNA") {
                  // Count fire units in enemy graveyard
                  const fireCount = prev.graveyard.filter((c) => c.element === "Pyrus" && (c.type === "unit")).length
                  bonus = fireCount * 2
                }
                // ULLRBOGI: no immediate bonus, only during battle
                if (bonus > 0) {
                  newUnitZone[matchIdx] = { ...unit, currentDp: unit.currentDp + bonus }
                }
              }
            }
            newHand.splice(i, 1)
            setEnemyUgAbilityUsed(false)
            break // Only one ultimate at a time
          }
        }

        for (let i = newHand.length - 1; i >= 0; i--) {
          const card = newHand[i]
          // Skip ultimate cards - they can only go in ultimate zone
          if (card && isUnitCard(card) && !isUltimateCard(card)) {
            const emptySlot = newUnitZone.findIndex((s) => s === null)
            if (emptySlot !== -1) {
              newUnitZone[emptySlot] = {
                ...card,
                currentDp: card.dp,
                canAttack: false,
                hasAttacked: false,
                canAttackTurn: turn,
              }
              newHand.splice(i, 1)
            }
          }
        }

        for (let i = newHand.length - 1; i >= 0; i--) {
          const card = newHand[i]
          // Skip scenario and ultimate cards
          if (card && !isUnitCard(card) && card.type !== "scenario") {
            const emptySlot = newFunctionZone.findIndex((s) => s === null)
            if (emptySlot !== -1) {
              newFunctionZone[emptySlot] = card
              newHand = newHand.filter((_, idx) => idx !== i)
            }
          }
        }

        return {
          ...prev,
          hand: newHand,
          unitZone: newUnitZone as (FieldCard | null)[],
          functionZone: newFunctionZone,
          scenarioZone: newScenarioZone,
          ultimateZone: newUltimateZone,
        }
      })

      setTimeout(() => {
        const botCanAttack = playerWentFirst ? turn >= 2 : turn >= 3 // Simplified bot attack condition

        // Bot ULLRBOGI: +3 DP to Ullr during battle phase
        setEnemyField((prevEnemy) => {
          if (prevEnemy.ultimateZone && prevEnemy.ultimateZone.ability === "ULLRBOGI" && prevEnemy.ultimateZone.requiresUnit) {
            const ullrIdx = prevEnemy.unitZone.findIndex((u) => u && u.name === prevEnemy.ultimateZone!.requiresUnit)
            if (ullrIdx !== -1 && prevEnemy.unitZone[ullrIdx]) {
              const newUnits = [...prevEnemy.unitZone]
              newUnits[ullrIdx] = { ...newUnits[ullrIdx]!, currentDp: newUnits[ullrIdx]!.currentDp + 3 }
              return { ...prevEnemy, unitZone: newUnits as (FieldCard | null)[] }
            }
          }
          return prevEnemy
        })

        // Bot also uses one-time UG abilities (ODEN SWORD and TWILIGH AVALON)
        setEnemyField((prevEnemy) => {
          if (!prevEnemy.ultimateZone || enemyUgAbilityUsed) return prevEnemy
          const ug = prevEnemy.ultimateZone
          const requiredUnit = ug.requiresUnit
          if (!requiredUnit) return prevEnemy
          const hasUnit = prevEnemy.unitZone.some((u) => u && u.name === requiredUnit)
          if (!hasUnit) return prevEnemy

          if (ug.ability === "ODEN SWORD") {
            // Destroy a player function card
            const funcIdx = playerField.functionZone.findIndex((f) => f !== null)
            if (funcIdx !== -1) {
              setPlayerField((prev) => {
                const newFuncs = [...prev.functionZone]
                const destroyed = newFuncs[funcIdx]
                newFuncs[funcIdx] = null
                return { ...prev, functionZone: newFuncs, graveyard: destroyed ? [...prev.graveyard, destroyed] : prev.graveyard }
              })
              setEnemyUgAbilityUsed(true)
              showEffectFeedback(`Bot ODEN SWORD: Function destruida!`, "error")
            }
          } else if (ug.ability === "TWILIGH AVALON") {
            // Return a player unit to hand and deal 3 damage
            const unitIdx = playerField.unitZone.findIndex((u) => u !== null)
            if (unitIdx !== -1) {
              const unit = playerField.unitZone[unitIdx]
              setPlayerField((prev) => {
                const newUnits = [...prev.unitZone]
                const returned = newUnits[unitIdx]
                newUnits[unitIdx] = null
                return {
                  ...prev,
                  unitZone: newUnits as (FieldCard | null)[],
                  hand: returned ? [...prev.hand, returned] : prev.hand,
                  life: Math.max(0, prev.life - 3),
                }
              })
              setEnemyUgAbilityUsed(true)
              showEffectFeedback(`Bot TWILIGH AVALON: ${unit?.name} devolvida! -3 LP!`, "error")
            }
          }
          return prevEnemy
        })

        if (botCanAttack) {
          setEnemyField((prevEnemy) => {
            const newEnemyUnitZone = [...prevEnemy.unitZone]
            const newEnemyGraveyard = [...prevEnemy.graveyard]

            newEnemyUnitZone.forEach((unit, unitIdx) => {
              if (unit && !unit.hasAttacked) {
                const playerUnitIndex = playerField.unitZone.findIndex((u) => u !== null)

                if (playerUnitIndex !== -1) {
                  const defender = playerField.unitZone[playerUnitIndex] as FieldCard
                  const defenderDp = defender.currentDp
                  const attackerDp = unit.currentDp

                  const newDefenderDp = defenderDp - attackerDp
                  const newAttackerDp = attackerDp - defenderDp

                  setPlayerField((prevPlayer) => {
                    const newPlayerUnitZone = [...prevPlayer.unitZone]
                    const newPlayerGraveyard = [...prevPlayer.graveyard]

                    // PROTONIX SWORD protection: player's unit cannot be destroyed in battle
                    const isProtectedByProtonix = prevPlayer.ultimateZone &&
                      prevPlayer.ultimateZone.ability === "PROTONIX SWORD" &&
                      prevPlayer.ultimateZone.requiresUnit === defender.name

                    if (newDefenderDp <= 0) {
                      if (isProtectedByProtonix) {
                        // Protected: stays at 1 DP
                        newPlayerUnitZone[playerUnitIndex] = { ...defender, currentDp: 1 }
                        showEffectFeedback(`PROTONIX SWORD: ${defender.name} protegida! Resta 1 DP`, "success")
                      } else {
                        newPlayerGraveyard.push(defender)
                        newPlayerUnitZone[playerUnitIndex] = null
                      }
                    } else {
                      newPlayerUnitZone[playerUnitIndex] = { ...defender, currentDp: newDefenderDp }
                    }

                    return {
                      ...prevPlayer,
                      unitZone: newPlayerUnitZone,
                      graveyard: newPlayerGraveyard,
                    }
                  })

                  if (newAttackerDp <= 0) {
                    newEnemyGraveyard.push(unit)
                    newEnemyUnitZone[unitIdx] = null
                  } else {
                    newEnemyUnitZone[unitIdx] = { ...unit, currentDp: newAttackerDp, hasAttacked: true }
                  }
                } else {
                  setPlayerField((prevPlayer) => ({
                    ...prevPlayer,
                    life: Math.max(0, prevPlayer.life - unit.currentDp),
                  }))
                  newEnemyUnitZone[unitIdx] = { ...unit, hasAttacked: true }
                }
              }
            })

            return {
              ...prevEnemy,
              unitZone: newEnemyUnitZone as (FieldCard | null)[],
              graveyard: newEnemyGraveyard,
            }
          })
        }

        // Bot ULLRBOGI: remove +3 DP when leaving battle phase
        setEnemyField((prevEnemy) => {
          if (prevEnemy.ultimateZone && prevEnemy.ultimateZone.ability === "ULLRBOGI" && prevEnemy.ultimateZone.requiresUnit) {
            const ullrIdx = prevEnemy.unitZone.findIndex((u) => u && u.name === prevEnemy.ultimateZone!.requiresUnit)
            if (ullrIdx !== -1 && prevEnemy.unitZone[ullrIdx]) {
              const newUnits = [...prevEnemy.unitZone]
              newUnits[ullrIdx] = { ...newUnits[ullrIdx]!, currentDp: Math.max(0, newUnits[ullrIdx]!.currentDp - 3) }
              return { ...prevEnemy, unitZone: newUnits as (FieldCard | null)[] }
            }
          }
          return prevEnemy
        })

        setTimeout(() => {
          setTurn((prev) => prev + 1)
          setPhase("draw")
          setIsPlayerTurn(true)

          // Reset attack status and enable attacking for units that can now attack
          setPlayerField((prev) => ({
            ...prev,
            unitZone: prev.unitZone.map((unit) =>
              unit ? { ...unit, hasAttacked: false, canAttack: turn > unit.canAttackTurn } : null,
            ),
            ultimateZone: prev.ultimateZone
              ? { ...prev.ultimateZone, hasAttacked: false, canAttack: turn > prev.ultimateZone.canAttackTurn }
              : null,
          }))
          setEnemyField((prev) => ({
            // Also reset enemy units for the next turn if it becomes their turn
            ...prev,
            unitZone: prev.unitZone.map((unit) => (unit ? { ...unit, hasAttacked: false, canAttack: true } : null)),
            ultimateZone: prev.ultimateZone
              ? { ...prev.ultimateZone, hasAttacked: false, canAttack: true }
              : null,
          }))
        }, 500)
      }, 800)
    }, 500)
  }

  const endTurn = () => {
    setPhase("end")

    setPlayerField((prev) => ({
      ...prev,
      unitZone: prev.unitZone.map((unit) => (unit ? { ...unit, hasAttacked: false } : null)),
    }))

    setTimeout(() => {
      const nextTurn = turn + 1
      setTurn(nextTurn)
      setIsPlayerTurn(false)
      setPhase("draw")

      setEnemyField((prev) => ({
        ...prev,
        unitZone: prev.unitZone.map((unit) =>
          unit ? { ...unit, hasAttacked: false, canAttack: nextTurn > unit.canAttackTurn } : null,
        ),
      }))

      if (mode === "bot") {
        setTimeout(() => executeBotTurn(), 1000)
      }
    }, 500)
  }

  const endEnemyTurn = () => {
    setPhase("end")

    setEnemyField((prev) => ({
      ...prev,
      unitZone: prev.unitZone.map((unit) => (unit ? { ...unit, hasAttacked: false } : null)),
    }))

    // Bot ULLRBOGI: remove +3 DP from Ullr when ending turn (leaving battle phase)
    setEnemyField((prevEnemy) => {
      if (prevEnemy.ultimateZone && prevEnemy.ultimateZone.ability === "ULLRBOGI" && prevEnemy.ultimateZone.requiresUnit) {
        const ullrIdx = prevEnemy.unitZone.findIndex((u) => u && u.name === prevEnemy.ultimateZone!.requiresUnit)
        if (ullrIdx !== -1 && prevEnemy.unitZone[ullrIdx]) {
          const newUnits = [...prevEnemy.unitZone]
          newUnits[ullrIdx] = { ...newUnits[ullrIdx]!, currentDp: Math.max(0, newUnits[ullrIdx]!.currentDp - 3) }
          return { ...prevEnemy, unitZone: newUnits as (FieldCard | null)[] }
        }
      }
      return prevEnemy
    })

    setTimeout(() => {
      const nextTurn = turn + 1
      setTurn(nextTurn)
      setIsPlayerTurn(true)
      setPhase("draw")

      setPlayerField((prev) => ({
        ...prev,
        unitZone: prev.unitZone.map((unit) =>
          unit ? { ...unit, hasAttacked: false, canAttack: nextTurn > unit.canAttackTurn } : null,
        ),
        ultimateZone: prev.ultimateZone
          ? { ...prev.ultimateZone, hasAttacked: false, canAttack: nextTurn > prev.ultimateZone.canAttackTurn }
          : null,
      }))
    }, 500)
  }

  const surrender = () => {
    setGameResult("lost")
    addMatchRecord({
      id: `match-${Date.now()}`,
      date: new Date().toISOString(),
      opponent: mode === "bot" ? "Bot" : "Player",
      mode,
      result: "lost",
      deckUsed: selectedDeck?.name || "Unknown",
    })
  }

const handleEnemyUnitSelect = (index: number) => {
  if (!itemSelectionMode.active || itemSelectionMode.step !== "selectEnemy") return
  const enemyUnit = enemyField.unitZone[index]
  if (!enemyUnit) return
  
  // If this is Véu dos Laços Cruzados with "debuff" option, resolve immediately
  if (itemSelectionMode.chosenOption === "debuff" && itemSelectionMode.itemCard) {
    let effect = getFunctionCardEffect(itemSelectionMode.itemCard)
    if (!effect && itemSelectionMode.itemCard.name === "Véu dos Laços Cruzados") {
      effect = FUNCTION_CARD_EFFECTS["veu-dos-lacos-cruzados"]
    }
    
  if (effect) {
  const effectContext: EffectContext = {
  playerField,
  enemyField,
  setPlayerField,
  setEnemyField,
  }
  
  const targets: EffectTargets = {
  enemyUnitIndices: [index],
  allyUnitIndices: [],
  chosenOption: "debuff",
  }
  
  const cardToUse = itemSelectionMode.itemCard
  setItemSelectionMode({ active: false, itemCard: null, step: "selectEnemy", selectedEnemyIndex: null, chosenOption: null })
  
  // Use async resolve for dice cards
  resolveEffectWithDice(effect, effectContext, targets, cardToUse.name).then((result) => {
    if (result.success) {
      showEffectFeedback(`${cardToUse.name}: ${result.message}`, "success")
      setPlayerField((prev) => ({
        ...prev,
        graveyard: [...prev.graveyard, cardToUse],
      }))
    } else {
      showEffectFeedback(`${cardToUse.name}: ${result.message || "Falha"}`, "error")
    }
  })
  return
  }
  }
  
  setItemSelectionMode((prev) => ({
  ...prev,
  step: "selectAlly",
  selectedEnemyIndex: index,
  }))
  }

const handleAllyUnitSelect = (index: number) => {
  if (!itemSelectionMode.active || itemSelectionMode.step !== "selectAlly") return
  if (!itemSelectionMode.itemCard) return
  
  // Check if this is a dice card (they don't need selectedEnemyIndex)
  const cardId = getBaseCardId(itemSelectionMode.itemCard.id || "")
  const isDiceCard = cardId.includes("dados-do-destino") || cardId.includes("dados-elementais")
  
  // For Véu dos Laços Cruzados with "buff" option, we don't need selectedEnemyIndex
  const isVeuBuff = itemSelectionMode.chosenOption === "buff"
  
  // Skip the selectedEnemyIndex check for dice cards and buff options
  if (itemSelectionMode.selectedEnemyIndex === null && !isVeuBuff && !isDiceCard) return
  
  const allyUnit = playerField.unitZone[index]
  if (!allyUnit) return
  
  // For Véu dos Laços Cruzados buff, check if unit is Fehnon or Jaden
  if (isVeuBuff && allyUnit.name !== "Fehnon Hoskie" && allyUnit.name !== "Jaden Hainaegi") {
    showEffectFeedback("Selecione Fehnon Hoskie ou Jaden Hainaegi", "error")
    return
  }
  
  // Use centralized effect resolver
  let effect = getFunctionCardEffect(itemSelectionMode.itemCard)
  
  // Fallback: find effect by name
  if (!effect) {
  const isAmplificador = itemSelectionMode.itemCard.name === "Amplificador de Poder"
  const isBandagem = itemSelectionMode.itemCard.name === "Bandagem Restauradora"
  const isAdaga = itemSelectionMode.itemCard.name === "Adaga Energizada"
  const isBandagensDuplas = itemSelectionMode.itemCard.name === "Bandagens Duplas"
  const isCristalRecuperador = itemSelectionMode.itemCard.name === "Cristal Recuperador"
  const isCaudaDeDragao = itemSelectionMode.itemCard.name === "Cauda de Dragão Assada"
  const isProjetilDeImpacto = itemSelectionMode.itemCard.name === "Projétil de Impacto"
      const isVeuDosLacos = itemSelectionMode.itemCard.name === "Véu dos Laços Cruzados"
      const isNucleoExplosivo = itemSelectionMode.itemCard.name === "Núcleo Explosivo"
      const isKitMedico = itemSelectionMode.itemCard.name === "Kit Médico Improvisado"
      const isSoroRecuperador = itemSelectionMode.itemCard.name === "Soro Recuperador"
      const isOrdemDeLaceracao = itemSelectionMode.itemCard.name === "Ordem de Laceração"
      const isSinfoniaRelampago = itemSelectionMode.itemCard.name === "Sinfonia Relâmpago"
      const isFafnisbani = itemSelectionMode.itemCard.name === "Fafnisbani"
      const isDevorarOMundo = itemSelectionMode.itemCard.name === "Devorar o Mundo"
      const isDadosDestinoGentil = itemSelectionMode.itemCard.name === "Dados do Destino Gentil"
      const isDadosElementaisAlpha = itemSelectionMode.itemCard.name === "Dados Elementais Alpha"
      const isDadosElementaisOmega = itemSelectionMode.itemCard.name === "Dados Elementais Omega"
      if (isAmplificador) effect = FUNCTION_CARD_EFFECTS["amplificador-de-poder"]
      else if (isBandagem) effect = FUNCTION_CARD_EFFECTS["bandagem-restauradora"]
      else if (isAdaga) effect = FUNCTION_CARD_EFFECTS["adaga-energizada"]
      else if (isBandagensDuplas) effect = FUNCTION_CARD_EFFECTS["bandagens-duplas"]
      else if (isCristalRecuperador) effect = FUNCTION_CARD_EFFECTS["cristal-recuperador"]
      else if (isCaudaDeDragao) effect = FUNCTION_CARD_EFFECTS["cauda-de-dragao-assada"]
      else if (isProjetilDeImpacto) effect = FUNCTION_CARD_EFFECTS["projetil-de-impacto"]
      else if (isVeuDosLacos) effect = FUNCTION_CARD_EFFECTS["veu-dos-lacos-cruzados"]
      else if (isNucleoExplosivo) effect = FUNCTION_CARD_EFFECTS["nucleo-explosivo"]
      else if (isKitMedico) effect = FUNCTION_CARD_EFFECTS["kit-medico-improvisado"]
      else if (isSoroRecuperador) effect = FUNCTION_CARD_EFFECTS["soro-recuperador"]
      else if (isOrdemDeLaceracao) effect = FUNCTION_CARD_EFFECTS["ordem-de-laceracao"]
      else if (isSinfoniaRelampago) effect = FUNCTION_CARD_EFFECTS["sinfonia-relampago"]
      else if (isFafnisbani) effect = FUNCTION_CARD_EFFECTS["fafnisbani"]
      else if (isDevorarOMundo) effect = FUNCTION_CARD_EFFECTS["devorar-o-mundo"]
      else if (isDadosDestinoGentil) effect = FUNCTION_CARD_EFFECTS["dados-do-destino-gentil"]
      else if (isDadosElementaisAlpha) effect = FUNCTION_CARD_EFFECTS["dados-elementais-alpha"]
      else if (isDadosElementaisOmega) effect = FUNCTION_CARD_EFFECTS["dados-elementais-omega"]
      }
    
  if (effect) {
  const effectContext: EffectContext = {
  playerField,
  enemyField,
  setPlayerField,
  setEnemyField,
  }
  
  const targets: EffectTargets = {
  enemyUnitIndices: itemSelectionMode.selectedEnemyIndex !== null ? [itemSelectionMode.selectedEnemyIndex] : [],
  allyUnitIndices: [index],
  chosenOption: itemSelectionMode.chosenOption || undefined,
  }
  
  const cardToUse = itemSelectionMode.itemCard
  setItemSelectionMode({ active: false, itemCard: null, step: "selectEnemy", selectedEnemyIndex: null, chosenOption: null })
  
  // Use async resolve for dice cards
  resolveEffectWithDice(effect, effectContext, targets, cardToUse.name).then((result) => {
    if (result.success) {
      showEffectFeedback(`${cardToUse.name}: ${result.message}`, "success")
      setPlayerField((prev) => ({
        ...prev,
        graveyard: [...prev.graveyard, cardToUse],
      }))
    } else {
      showEffectFeedback(`${cardToUse.name}: ${result.message || "Falha"}`, "error")
    }
  })
  return
  }
  }

  const cancelItemSelection = () => {
    if (itemSelectionMode.itemCard) {
      setPlayerField((prev) => ({
        ...prev,
        hand: [...prev.hand, itemSelectionMode.itemCard!],
      }))
    }
    setItemSelectionMode({ active: false, itemCard: null, step: "selectEnemy", selectedEnemyIndex: null, chosenOption: null })
  }

  useEffect(() => {
    if (!gameStarted || gameResultRecordedRef.current) return

    if (playerField.life <= 0) {
      gameResultRecordedRef.current = true
      setGameResult("lost")
      addMatchRecord({
        id: `match-${Date.now()}`,
        date: new Date().toISOString(),
        opponent: mode === "bot" ? "Bot" : "Player",
        mode,
        result: "lost",
        deckUsed: selectedDeck?.name || "Unknown",
      })
    } else if (enemyField.life <= 0) {
      gameResultRecordedRef.current = true
      setGameResult("won")
      addMatchRecord({
        id: `match-${Date.now()}`,
        date: new Date().toISOString(),
        opponent: mode === "bot" ? "Bot" : "Player",
        mode,
        result: "won",
        deckUsed: selectedDeck?.name || "Unknown",
      })
    }
  }, [playerField.life, enemyField.life, gameStarted, mode, selectedDeck?.name])

  if (!gameStarted) {
    return (
      <div className="min-h-screen flex flex-col">
        <div className="flex items-center justify-between p-4 bg-black/50">
          <Button onClick={onBack} variant="ghost" className="text-white">
            <ArrowLeft className="mr-2 h-5 w-5" />
            {t("back")}
          </Button>
          <h1 className="text-2xl font-bold text-white">{mode === "bot" ? t("vsBot") : t("vsPlayer")}</h1>
          <div className="w-20" />
        </div>

        <div className="flex-1 flex flex-col items-center justify-center p-4">
          <h2 className="text-xl text-white mb-6">Selecione um Deck</h2>

          {typedDecks.length === 0 ? (
            <p className="text-slate-400">Crie um deck primeiro no menu Construir Deck!</p>
          ) : (
            <div className="grid gap-4 w-full max-w-md">
              {typedDecks.map((deck) => (
                <Button
                  key={deck.id}
                  onClick={() => startGame(deck)}
                  className="h-16 text-lg bg-gradient-to-r from-slate-700 to-slate-600 hover:from-slate-600 hover:to-slate-500"
                >
                  <Swords className="mr-2" />
                  {deck.name} ({deck.cards.length} cartas)
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (gameResult) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-black/90">
        <h1 className={`text-6xl font-bold mb-8 ${gameResult === "won" ? "text-green-400" : "text-red-400"}`}>
          {gameResult === "won" ? t("victory") : t("defeat")}
        </h1>
        <Button onClick={onBack} className="px-8 py-4 text-xl bg-gradient-to-r from-slate-700 to-slate-600">
          {t("back")}
        </Button>
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
        handleHandCardDragMove(e)
      }}
      onMouseUp={() => {
        handleAttackEnd()
        handleHandCardDragEnd()
      }}
      onMouseLeave={() => {
        handleAttackEnd()
        handleHandCardDragEnd()
      }}
      onTouchMove={(e) => {
        handleAttackMove(e)
        handleHandCardDragMove(e)
      }}
      onTouchEnd={() => {
        handleAttackEnd()
        handleHandCardDragEnd()
      }}
    >
      {/* Impact Flash Overlay - Epic cinematic effect */}
      {impactFlash.active && (
        <div 
          className="absolute inset-0 z-50 pointer-events-none"
          style={{ 
            background: `radial-gradient(circle at center, ${impactFlash.color} 0%, transparent 70%)`,
            animation: "epicFlash 0.25s ease-out forwards"
          }}
        />
      )}

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

      <canvas
        ref={explosionCanvasRef}
        className="fixed inset-0 pointer-events-none z-[60]"
        style={{ width: "100vw", height: "100vh" }}
      />

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
            <filter id="professionalGlow">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feColorMatrix
                in="blur"
                type="matrix"
                values="1 0 0 0 0  0 0.3 0 0 0  0 0 0.3 0 0  0 0 0 0.5 0"
                result="redBlur"
              />
              <feMerge>
                <feMergeNode in="redBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
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
          
          {/* Main arrow with border effect */}
          <line
            x1={arrowPos.x1}
            y1={arrowPos.y1}
            x2={arrowPos.x2}
            y2={arrowPos.y2}
            stroke="#b91c1c"
            strokeWidth="5"
            strokeLinecap="round"
            opacity="0.7"
          />
          
          {/* Main arrow */}
          <line
            ref={arrowRef}
            x1={arrowPos.x1}
            y1={arrowPos.y1}
            x2={arrowPos.x2}
            y2={arrowPos.y2}
            stroke="url(#arrowGradient)"
            strokeWidth="4"
            markerEnd="url(#arrowhead)"
            filter="url(#professionalGlow)"
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
            <span className="text-xs text-slate-400">Oponente</span>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-red-400">LP: {enemyField.life}</span>
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
              isPlayerTurn
                ? "bg-green-600/20 border-green-500 text-green-400"
                : "bg-red-600/20 border-red-500 text-red-400"
            }`}
          >
            {isPlayerTurn ? t("yourTurn") : t("enemyTurn")}
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
          {enemyField.hand.map((_, i) => (
            <div
              key={i}
              className="w-6 h-8 bg-gradient-to-br from-slate-700 via-slate-600 to-slate-800 rounded border border-slate-500/50 shadow-md"
              style={{
                transform: `rotate(${(i - enemyField.hand.length / 2) * 3}deg) translateY(${Math.abs(i - enemyField.hand.length / 2) * 2}px)`,
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
            {/* Enemy side background */}
            <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-red-950/30 to-transparent" />

            {/* Player Playmat Background */}
            {(() => {
              const playmat = selectedDeck ? getPlaymatForDeck(selectedDeck) : null
              if (playmat) {
                return (
                  <div className="absolute inset-x-0 bottom-0 h-1/2 overflow-hidden">
                    <img
                      src={playmat.image || "/placeholder.svg"}
                      alt={playmat.name}
                      className="w-full h-full object-cover"
                      style={{ opacity: 0.6 }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-transparent via-transparent to-slate-900/60" />
                  </div>
                )
              }
              return (
                <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-blue-950/30 to-transparent" />
              )
            })()}
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
                    {enemyField.graveyard.length}
                  </div>
                  <div className="w-14 h-20 bg-red-700/80 rounded text-sm text-white flex items-center justify-center font-bold border border-red-500/50">
                    {enemyField.deck.length}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  {/* Enemy Scenario Zone - Horizontal slot, aligned with unit zone */}
                  <div className="h-14 w-20 bg-amber-900/40 border border-amber-600/40 rounded flex items-center justify-center relative overflow-hidden">
                    {enemyField.scenarioZone ? (
                      <Image
                        src={enemyField.scenarioZone.image || "/placeholder.svg"}
                        alt={enemyField.scenarioZone.name}
                        fill
                        className="object-cover rounded"
                        onMouseDown={() => handleCardPressStart(enemyField.scenarioZone!)}
                        onMouseUp={handleCardPressEnd}
                        onMouseLeave={handleCardPressEnd}
                        onTouchStart={() => handleCardPressStart(enemyField.scenarioZone!)}
                        onTouchEnd={handleCardPressEnd}
                      />
                    ) : (
                      <span className="text-amber-500/50 text-[8px] text-center">SCENARIO</span>
                    )}
                  </div>
                  {/* Enemy Ultimate Zone - single slot, green */}
                  <div className="w-14 h-20 bg-emerald-900/40 border border-emerald-600/40 rounded flex items-center justify-center relative overflow-hidden mx-auto">
                    {enemyField.ultimateZone ? (
                      <Image
                        src={enemyField.ultimateZone.image || "/placeholder.svg"}
                        alt={enemyField.ultimateZone.name}
                        fill
                        className="object-cover rounded"
                        onMouseDown={() => handleCardPressStart(enemyField.ultimateZone!)}
                        onMouseUp={handleCardPressEnd}
                        onMouseLeave={handleCardPressEnd}
                        onTouchStart={() => handleCardPressStart(enemyField.ultimateZone!)}
                        onTouchEnd={handleCardPressEnd}
                      />
                    ) : null}
                    {enemyField.ultimateZone && (
                      <div className="absolute bottom-0 left-0 right-0 bg-black/80 text-center text-xs text-white font-bold py-0.5">
                        {enemyField.ultimateZone.currentDp} DP
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Enemy Zones */}
              <div className="flex flex-col gap-1.5">
                {/* Enemy Function Zone */}
                <div className="flex justify-center items-center gap-1.5">
                  {enemyField.functionZone.map((card, i) => {
                    const isUgTarget = ugTargetMode.active && card && (
                      ugTargetMode.type === "oden_sword" || ugTargetMode.type === "twiligh_avalon"
                    )
                    return (
                      <div
                        key={i}
                        onClick={() => {
                          if (ugTargetMode.active && ugTargetMode.type === "oden_sword" && card) {
                            handleUgTargetEnemyFunction(i)
                          } else if (ugTargetMode.active && ugTargetMode.type === "twiligh_avalon" && card) {
                            handleUgTargetEnemyCard("function", i)
                          }
                        }}
                        className={`w-14 h-20 bg-purple-900/40 border-2 rounded flex items-center justify-center relative overflow-hidden transition-all ${
                          isUgTarget
                            ? "border-yellow-400 cursor-pointer hover:bg-yellow-900/30 ring-2 ring-yellow-400/50 animate-pulse"
                            : "border-purple-600/40"
                        }`}
                      >
                        {card && (
                          <Image
                            src={card.image || "/placeholder.svg"}
                            alt={card.name}
                            fill
                            className="object-cover rounded"
                          />
                        )}
                      </div>
                    )
                  })}
              </div>

              {/* Enemy Unit Zone */}
              <div className="flex justify-center items-center gap-1.5">
                {enemyField.unitZone.map((card, i) => (
                  <div
                    key={i}
                    data-enemy-unit={i}
                    onClick={() => {
                      if (ugTargetMode.active && ugTargetMode.type === "twiligh_avalon" && card) {
                        handleUgTargetEnemyCard("unit", i)
                      } else if (itemSelectionMode.active && itemSelectionMode.step === "selectEnemy") {
                        handleEnemyUnitSelect(i)
                      }
                    }}
                    className={`w-14 h-20 bg-red-900/30 border-2 rounded relative overflow-hidden transition-all ${
                      ugTargetMode.active && ugTargetMode.type === "twiligh_avalon" && card
                        ? "border-yellow-400 cursor-pointer hover:bg-yellow-900/30 ring-2 ring-yellow-400/50 animate-pulse"
                        : attackTarget?.type === "unit" && attackTarget.index === i
                          ? "border-red-500 ring-2 ring-red-400 scale-105"
                          : itemSelectionMode.active && itemSelectionMode.step === "selectEnemy" && card
                            ? "border-yellow-500 cursor-pointer hover:bg-yellow-900/30"
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
                  {phase === "draw" ? "DRAW" : phase === "main" ? "MAIN" : "BATTLE"}
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
                  {playerField.unitZone.map((card, i) => {
                    const isDropTarget =
                      draggedHandCard &&
                      isUnitCard(draggedHandCard.card) &&
                      !card &&
                      draggedHandCard.currentY < window.innerHeight * 0.6
                    const canAttack = card && canUnitAttackNow(card as FieldCard)

                    return (
                      <div
                        key={i}
                        data-player-unit-slot={i}
                        onClick={() => {
                          if (selectedHandCard !== null) {
                            placeCard("unit", i)
                          } else if (itemSelectionMode.active && itemSelectionMode.step === "selectAlly" && card) {
                            handleAllyUnitSelect(i)
                          }
                        }}
                        className={`w-14 h-20 bg-blue-900/30 border-2 rounded relative overflow-hidden transition-all duration-200 ${
                          dropTarget?.type === "unit" && dropTarget?.index === i && !card
                            ? "border-green-400 bg-green-500/60 scale-115 shadow-lg shadow-green-500/50 ring-2 ring-green-400/50 animate-pulse"
                            : isDropTarget
                              ? "border-green-400/70 bg-green-500/30 scale-105"
                              : selectedHandCard !== null && isUnitCard(playerField.hand[selectedHandCard])
                                ? "border-green-500 bg-green-900/40 cursor-pointer"
                                : draggedHandCard && isUnitCard(draggedHandCard.card)
                                  ? "border-blue-400/50 bg-blue-500/20"
                                  : itemSelectionMode.active && itemSelectionMode.step === "selectAlly" && card
                                    ? "border-yellow-500 cursor-pointer hover:bg-yellow-900/30"
                                    : canAttack
                                      ? "border-yellow-400 shadow-lg shadow-yellow-500/40"
                                      : "border-blue-700/40"
                        }`}
                      >
                        {/* Yellow glow for playable/attackable cards */}
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
                          </>
                        )}
                        {!card && isDropTarget && (
                          <span className="text-green-400 text-xs font-bold animate-pulse">SOLTAR</span>
                        )}
                      </div>
                    )
                  })}
                </div>

              {/* Player Function Zone */}
              <div className="flex justify-center items-center gap-1.5">
                {playerField.functionZone.map((card, i) => {
                  const isDropTarget =
                    draggedHandCard &&
                    !isUnitCard(draggedHandCard.card) &&
                    !card &&
                    draggedHandCard.currentY < window.innerHeight * 0.6

                  return (
                    <div
                      key={i}
                      data-player-func-slot={i}
                      onClick={() => selectedHandCard !== null && placeCard("function", i)}
                      className={`w-14 h-20 bg-purple-900/30 border-2 rounded flex items-center justify-center cursor-pointer transition-all duration-200 relative overflow-hidden ${
                        dropTarget?.type === "function" && dropTarget?.index === i && !card
                          ? "border-green-400 bg-green-500/60 scale-115 shadow-lg shadow-green-500/50 ring-2 ring-green-400/50 animate-pulse"
                          : isDropTarget
                            ? "border-green-400/70 bg-green-500/30 scale-105"
                            : selectedHandCard !== null && !isUnitCard(playerField.hand[selectedHandCard])
                              ? "border-green-500 bg-green-900/40"
                              : draggedHandCard && !isUnitCard(draggedHandCard.card)
                                ? "border-purple-400/50 bg-purple-500/20"
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
                      {!card && isDropTarget && (
                        <span className="text-green-400 text-[10px] font-bold animate-pulse">SOLTAR</span>
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
                  <div 
                    data-player-scenario-slot
                    onClick={() => selectedHandCard !== null && playerField.hand[selectedHandCard]?.type === "scenario" && placeScenarioCard()}
                    className={`h-14 w-20 bg-amber-900/30 border-2 rounded flex items-center justify-center relative overflow-hidden transition-all duration-200 ${
                      dropTarget?.type === "scenario" && !playerField.scenarioZone
                        ? "border-green-400 bg-green-500/60 scale-110 shadow-lg shadow-green-500/50 ring-2 ring-green-400/50 animate-pulse"
                        : selectedHandCard !== null && playerField.hand[selectedHandCard]?.type === "scenario"
                          ? "border-green-500 bg-green-900/40 cursor-pointer"
                          : draggedHandCard && draggedHandCard.card.type === "scenario"
                            ? "border-amber-400/50 bg-amber-500/20"
                            : "border-amber-600/40"
                    }`}
                  >
                    {playerField.scenarioZone ? (
                      <Image
                        src={playerField.scenarioZone.image || "/placeholder.svg"}
                        alt={playerField.scenarioZone.name}
                        fill
                        className="object-cover rounded"
                        onMouseDown={() => handleCardPressStart(playerField.scenarioZone!)}
                        onMouseUp={handleCardPressEnd}
                        onMouseLeave={handleCardPressEnd}
                        onTouchStart={() => handleCardPressStart(playerField.scenarioZone!)}
                        onTouchEnd={handleCardPressEnd}
                      />
                    ) : (
                      <span className="text-amber-500/50 text-[8px] text-center">SCENARIO</span>
                    )}
                  </div>
                  {/* Player Ultimate Zone - single green slot below scenario */}
                  <div 
                    data-player-ultimate-slot
                    onClick={() => selectedHandCard !== null && playerField.hand[selectedHandCard] && isUltimateCard(playerField.hand[selectedHandCard]) && placeUltimateCard()}
                    className={`w-14 h-20 bg-emerald-900/30 border-2 rounded flex items-center justify-center relative overflow-hidden transition-all duration-200 mx-auto ${
                      dropTarget?.type === "ultimate" && !playerField.ultimateZone
                        ? "border-green-400 bg-green-500/60 scale-110 shadow-lg shadow-green-500/50 ring-2 ring-green-400/50 animate-pulse"
                        : selectedHandCard !== null && playerField.hand[selectedHandCard] && isUltimateCard(playerField.hand[selectedHandCard])
                          ? "border-emerald-400 bg-emerald-900/40 cursor-pointer"
                          : draggedHandCard && isUltimateCard(draggedHandCard.card)
                            ? "border-emerald-400/50 bg-emerald-500/20"
                            : "border-emerald-600/40"
                    }`}
                  >
                    {playerField.ultimateZone ? (
                      <>
                        <Image
                          src={playerField.ultimateZone.image || "/placeholder.svg"}
                          alt={playerField.ultimateZone.name}
                          fill
                          className="object-cover rounded"
                          onMouseDown={() => handleCardPressStart(playerField.ultimateZone!)}
                          onMouseUp={handleCardPressEnd}
                          onMouseLeave={handleCardPressEnd}
                          onTouchStart={() => handleCardPressStart(playerField.ultimateZone!)}
                          onTouchEnd={handleCardPressEnd}
                        />
                        <div className="absolute bottom-0 left-0 right-0 bg-black/80 text-center text-xs text-white font-bold py-0.5">
                          {playerField.ultimateZone.currentDp} DP
                        </div>
                        {/* Activate button for one-time abilities (ODEN SWORD, TWILIGH AVALON) */}
                        {isPlayerTurn && phase === "main" && !playerUgAbilityUsed && !ugTargetMode.active &&
                          (playerField.ultimateZone.ability === "ODEN SWORD" || playerField.ultimateZone.ability === "TWILIGH AVALON") &&
                          playerField.ultimateZone.requiresUnit &&
                          findUnitByName(playerField.unitZone, playerField.ultimateZone.requiresUnit) !== -1 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); activateUgAbility() }}
                            className="absolute -top-5 left-1/2 -translate-x-1/2 bg-yellow-500 hover:bg-yellow-400 text-black text-[7px] font-bold px-1.5 py-0.5 rounded shadow-lg shadow-yellow-500/50 animate-pulse whitespace-nowrap z-10"
                          >
                            ATIVAR
                          </button>
                        )}
                      </>
                    ) : null}
                    {!playerField.ultimateZone && dropTarget?.type === "ultimate" && (
                      <span className="text-green-400 text-[10px] font-bold animate-pulse">SOLTAR</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <div className="w-14 h-20 bg-blue-700/80 rounded text-sm text-white flex items-center justify-center font-bold border border-blue-500/50">
                    {playerField.deck.length}
                  </div>
                  <div 
                    className="w-14 h-20 bg-purple-900/80 rounded text-sm text-purple-300 flex items-center justify-center border border-purple-500/50 cursor-pointer hover:bg-purple-800/80 transition-colors"
                    onClick={() => setGraveyardView("player")}
                  >
                    {playerField.graveyard.length}
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
              <span className="text-xs text-slate-400">Você</span>
              <div className="text-xl font-bold text-blue-400">LP: {playerField.life}</div>
            </div>
          </div>

          {/* Phase buttons - Fixed height to prevent layout shift */}
          <div className="flex gap-2 min-h-[40px]">
            {isPlayerTurn && phase === "draw" && (
              <Button
                onClick={advancePhase}
                size="default"
                className="bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white font-bold px-6 shadow-lg shadow-green-500/30"
              >
                {t("drawCard")}
              </Button>
            )}
            {isPlayerTurn && phase === "main" && (
              <Button
                onClick={advancePhase}
                size="default"
                className="bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-bold px-6 shadow-lg shadow-blue-500/30"
              >
                {t("toBattle")}
              </Button>
            )}
            {isPlayerTurn && phase === "battle" && (
              <Button
                onClick={endTurn}
                size="default"
                className="bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white font-bold px-6 shadow-lg shadow-amber-500/30"
              >
                {t("endTurn")}
              </Button>
            )}
          </div>
        </div>

        {/* Player Hand - PROMINENT display */}
        <div className="flex justify-center -mt-14 min-h-28">
          <div className="flex gap-3 items-end">
            {playerField.hand.map((card, i) => {
              const offset = i - (playerField.hand.length - 1) / 2
              const rotation = offset * 4
              const translateY = Math.abs(offset) * 5
              const isSelected = selectedHandCard === i
              const isDragging = draggedHandCard?.index === i
              
              // Check if card can be played: must be player turn, main phase, and have space in appropriate zone
              const hasSpaceInZone = isUltimateCard(card)
                ? playerField.ultimateZone === null
                : card.type === "scenario"
                  ? playerField.scenarioZone === null
                  : isUnitCard(card)
                    ? playerField.unitZone.some(slot => slot === null)
                    : playerField.functionZone.some(slot => slot === null)
              const canPlay = isPlayerTurn && phase === "main" && hasSpaceInZone

              return (
                <div
                  key={`hand-${card.id}-${i}`}
                  onMouseDown={(e) => {
                    if (canPlay) {
                      handleHandCardDragStart(i, e)
                    }
                    handleCardPressStart(card)
                  }}
                  onMouseUp={handleCardPressEnd}
                  onMouseLeave={handleCardPressEnd}
                  onTouchStart={(e) => {
                    if (canPlay) {
                      handleHandCardDragStart(i, e)
                    }
                    handleCardPressStart(card)
                  }}
                  onTouchEnd={handleCardPressEnd}
                  onClick={() => {
                    handleCardPressEnd()
                    if (canPlay && !draggedHandCard) {
                      setSelectedHandCard(i === selectedHandCard ? null : i)
                    }
                  }}
                  className={`relative cursor-grab active:cursor-grabbing select-none ${
                    isDragging ? "opacity-0 scale-75" : "opacity-100"
                  } ${!canPlay ? "opacity-60 cursor-not-allowed" : ""}`}
                  style={{
                    transform: `rotate(${rotation}deg) translateY(${isSelected ? -24 : translateY}px) scale(${isSelected ? 1.08 : 1})`,
                    zIndex: isSelected ? 100 : 50 - Math.abs(offset),
                    transition: 'transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.15s ease-out',
                  }}
                >
                  {/* Playable card glow effect */}
                  {canPlay && (
                    <div className="absolute -inset-1.5 bg-yellow-400/40 rounded-xl blur-md animate-pulse" />
                  )}
                  {isSelected && (
                    <div className="absolute -inset-2 bg-yellow-400/50 rounded-2xl blur-lg" />
                  )}
                  <div
                    className={`relative w-20 h-28 rounded-xl border-3 shadow-xl bg-slate-900 transition-all duration-150 ${
                      isSelected
                        ? "border-yellow-400 ring-4 ring-yellow-400/40 shadow-yellow-500/50"
                        : canPlay
                          ? "border-yellow-400/70 hover:border-yellow-400 hover:shadow-2xl hover:-translate-y-4 hover:scale-105 shadow-yellow-500/30"
                          : "border-slate-600/50"
                    }`}
                  >
                    <div className="relative w-full h-full overflow-hidden rounded-lg">
                      <Image src={card.image || "/placeholder.svg"} alt={card.name} fill className="object-contain" />
                    </div>
                  </div>
                  {/* Drag hint */}
                  {canPlay && isSelected && (
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

      {/* Dragged hand card ghost - GPU accelerated */}
      {draggedHandCard && (
        <div
          ref={draggedCardRef}
          className="fixed top-0 left-0 pointer-events-none z-[70]"
          style={{
            willChange: 'transform',
            transform: `translate(${dragPosRef.current.x - 40}px, ${dragPosRef.current.y - 56}px) rotate(0deg) scale(1.1)`,
          }}
        >
          {/* Glow */}
          <div className={`absolute -inset-3 rounded-xl blur-xl transition-all duration-150 ${
            dropTarget ? 'bg-green-400/60' : 'bg-yellow-400/40'
          }`} />
          {/* Card */}
          <div className={`relative w-20 h-28 rounded-xl border-3 shadow-2xl overflow-hidden bg-slate-900 transition-all duration-100 ${
            dropTarget 
              ? 'border-green-400 shadow-green-500/60' 
              : 'border-yellow-400 shadow-yellow-500/50'
          }`}>
            <img
              src={draggedHandCard.card.image || "/placeholder.svg"}
              alt={draggedHandCard.card.name}
              className="w-full h-full object-contain"
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
            style={{ animation: 'summonRing 500ms ease-out forwards' }}
          >
            <div className="w-20 h-20 rounded-full border-2 border-cyan-400/80" />
          </div>
          {/* Glow burst */}
          <div 
            className="absolute inset-0 flex items-center justify-center"
            style={{ animation: 'summonGlow 450ms ease-out forwards' }}
          >
            <div className="w-16 h-16 bg-cyan-400/50 rounded-full blur-2xl" />
          </div>
          {/* Card materializing */}
          <div 
            className="relative rounded-lg border-2 border-cyan-400 shadow-xl shadow-cyan-500/60 overflow-hidden bg-slate-900"
            style={{ 
              width: '64px', 
              height: '88px',
              animation: 'cardMaterialize 500ms ease-out forwards',
              transformStyle: 'preserve-3d',
            }}
          >
            <img
              src={droppingCard.card.image || "/placeholder.svg"}
              alt={droppingCard.card.name}
              className="w-full h-full object-contain"
              draggable={false}
            />
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
                      (Base: {inspectedCard.dp} DP | {(inspectedCard as FieldCard).currentDp > inspectedCard.dp ? "+" : ""}{(inspectedCard as FieldCard).currentDp - inspectedCard.dp})
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

      {/* Graveyard View Modal */}
      {graveyardView && (
        <div 
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/85"
          onClick={() => setGraveyardView(null)}
        >
          <div 
            className="relative bg-gradient-to-b from-slate-800 to-slate-900 rounded-2xl border-2 border-purple-500/50 p-6 max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-purple-400 font-bold text-xl mb-4 text-center">
              {graveyardView === "player" ? "Seu Cemiterio" : "Cemiterio do Oponente"}
            </h3>
            <div className="max-h-80 overflow-y-auto">
              {(graveyardView === "player" ? playerField.graveyard : enemyField.graveyard).length === 0 ? (
                <p className="text-gray-400 text-center py-8">Nenhuma carta no cemiterio</p>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {(graveyardView === "player" ? playerField.graveyard : enemyField.graveyard).map((card, i) => (
                    <div 
                      key={i}
                      className="relative w-16 h-22 rounded-lg border-2 border-purple-500/50 overflow-hidden bg-slate-800 cursor-pointer hover:border-purple-400 hover:scale-105 transition-all"
                      style={{ height: '88px' }}
                      onClick={() => {
                        setInspectedCard(card)
                      }}
                    >
                      <img
                        src={card.image || "/placeholder.svg"}
                        alt={card.name}
                        className="w-full h-full object-contain"
                      />
                      {isUnitCard(card) && (
                        <div className="absolute bottom-0 left-0 right-0 bg-black/80 text-white text-[8px] text-center py-0.5">
                          {card.dp} DP
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <Button
              onClick={() => setGraveyardView(null)}
              size="sm"
              variant="outline"
              className="mt-4 w-full bg-transparent text-purple-400 border-purple-500/50 hover:bg-purple-500/20"
            >
              Fechar
            </Button>
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
  
  {/* Dice Roll Animation */}
  {diceAnimation && (
  <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none">
    {/* Dark overlay */}
    <div className="absolute inset-0 bg-black/60 animate-fade-in" />
    
    {/* Dice container */}
    <div className="relative flex flex-col items-center gap-6">
      {/* Card name */}
      <div className="bg-gradient-to-r from-amber-900/90 to-orange-900/90 px-6 py-2 rounded-xl border border-amber-500/50 shadow-2xl">
        <p className="text-amber-400 font-bold text-lg">{diceAnimation.cardName}</p>
      </div>
      
      {/* 3D Dice */}
      <div className={`dice-scene ${diceAnimation.rolling ? 'dice-rolling' : ''}`}>
        <div className={`dice-cube ${!diceAnimation.rolling && diceAnimation.result ? `dice-face-${diceAnimation.result}` : ''}`}>
          <div className="dice-face dice-face-1">
            <span className="dice-dot"></span>
          </div>
          <div className="dice-face dice-face-2">
            <span className="dice-dot"></span>
            <span className="dice-dot"></span>
          </div>
          <div className="dice-face dice-face-3">
            <span className="dice-dot"></span>
            <span className="dice-dot"></span>
            <span className="dice-dot"></span>
          </div>
          <div className="dice-face dice-face-4">
            <span className="dice-dot"></span>
            <span className="dice-dot"></span>
            <span className="dice-dot"></span>
            <span className="dice-dot"></span>
          </div>
          <div className="dice-face dice-face-5">
            <span className="dice-dot"></span>
            <span className="dice-dot"></span>
            <span className="dice-dot"></span>
            <span className="dice-dot"></span>
            <span className="dice-dot"></span>
          </div>
          <div className="dice-face dice-face-6">
            <span className="dice-dot"></span>
            <span className="dice-dot"></span>
            <span className="dice-dot"></span>
            <span className="dice-dot"></span>
            <span className="dice-dot"></span>
            <span className="dice-dot"></span>
          </div>
        </div>
      </div>
      
      {/* Result display */}
      {!diceAnimation.rolling && diceAnimation.result && (
        <div className="dice-result-display">
          <div className="bg-gradient-to-r from-cyan-600 to-blue-600 px-8 py-4 rounded-2xl border-2 border-cyan-400/70 shadow-[0_0_30px_rgba(34,211,238,0.5)]">
            <p className="text-white font-bold text-3xl text-center">
              {diceAnimation.result}
            </p>
            <p className="text-cyan-200 text-sm text-center mt-1">
              {diceAnimation.result <= 3 ? "Resultado Baixo" : "Resultado Alto"}
            </p>
          </div>
        </div>
      )}
      
      {/* Rolling text */}
      {diceAnimation.rolling && (
        <p className="text-white font-bold text-xl animate-pulse">Rolando...</p>
      )}
    </div>
  </div>
  )}
  
  {/* Card Destruction Animation */}
  {destructionAnimation && (
  <div className="fixed inset-0 z-50 pointer-events-none overflow-hidden">
    {/* Shatter card animation at destruction position */}
    <div 
      className="destruction-container"
      style={{
        left: destructionAnimation.x,
        top: destructionAnimation.y,
      }}
    >
      {/* Card image that shatters */}
      <div className="destruction-card">
        <img 
          src={destructionAnimation.cardImage} 
          alt={destructionAnimation.cardName}
          className="w-full h-full object-cover rounded"
        />
      </div>
      
      {/* Shatter fragments */}
      {[...Array(12)].map((_, i) => (
        <div 
          key={i}
          className={`destruction-fragment destruction-fragment-${i + 1}`}
          style={{
            backgroundImage: `url(${destructionAnimation.cardImage})`,
            backgroundSize: '100% 100%',
          }}
        />
      ))}
      
      {/* Flash effect */}
      <div className="destruction-flash" />
      
      {/* Card name */}
      <div className="destruction-name">
        <span className="text-red-400 font-bold text-xs uppercase tracking-wider">
          {destructionAnimation.cardName}
        </span>
      </div>
    </div>
  </div>
  )}
  
  {/* Choice Modal for cards like Véu dos Laços Cruzados */}
  {choiceModal && choiceModal.visible && (
  <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-50">
    <div className="bg-gradient-to-b from-slate-800 to-slate-900 p-6 rounded-xl border-2 border-purple-500/50 text-center shadow-2xl max-w-sm mx-4">
      <h3 className="text-purple-400 font-bold text-xl mb-4">{choiceModal.cardName}</h3>
      <p className="text-white/80 text-sm mb-5">Escolha um dos efeitos:</p>
      <div className="flex flex-col gap-3">
        {choiceModal.options.map((option) => (
          <button
            key={option.id}
            onClick={() => choiceModal.onChoose(option.id)}
            className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold py-3 px-4 rounded-lg border border-purple-400/50 transition-all hover:scale-105"
          >
            <div className="text-lg">{option.label}</div>
            <div className="text-xs text-white/70 mt-1">{option.description}</div>
          </button>
        ))}
      </div>
      <Button
        onClick={() => setChoiceModal(null)}
        size="sm"
        variant="outline"
        className="mt-4 border-red-500/50 text-red-400 hover:bg-red-950/50"
      >
        Cancelar
      </Button>
    </div>
  </div>
  )}
  
        {/* UG Target Selection Mode overlay */}
        {ugTargetMode.active && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 bg-black/90 border border-yellow-500/50 rounded-xl px-4 py-3 text-center">
            <h3 className="text-yellow-400 font-bold text-sm mb-1">
              {ugTargetMode.type === "oden_sword" ? "ODEN SWORD" : "TWILIGH AVALON"}
            </h3>
            <p className="text-yellow-200/80 text-xs mb-2">
              {ugTargetMode.type === "oden_sword"
                ? "Selecione uma Function inimiga para destruir"
                : "Selecione uma carta inimiga para devolver a mao"
              }
            </p>
            <button
              onClick={cancelUgTargetMode}
              className="bg-red-600 hover:bg-red-500 text-white text-xs px-3 py-1 rounded font-bold"
            >
              CANCELAR
            </button>
          </div>
        )}

        {itemSelectionMode.active && itemSelectionMode.itemCard && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-40 pointer-events-none">
          <div className="bg-gradient-to-b from-slate-800 to-slate-900 p-5 rounded-xl border-2 border-yellow-500/50 text-center shadow-2xl pointer-events-auto">
            <h3 className="text-yellow-400 font-bold text-lg mb-3">{itemSelectionMode.itemCard.name}</h3>
  {(() => {
    const cardId = getBaseCardId(itemSelectionMode.itemCard?.id || "")
    const isDiceCard = cardId.includes("dados-do-destino") || cardId.includes("dados-elementais")
    
    if (isDiceCard) {
      return (
        <p className="text-white text-sm">
          Clique em uma unidade <span className="text-cyan-400 font-bold">SUA</span> para rolar o dado
        </p>
      )
    }
    
    if (itemSelectionMode.step === "selectEnemy") {
      return (
        <p className="text-white text-sm">
          {itemSelectionMode.chosenOption === "debuff" 
            ? <>Clique em uma unidade <span className="text-red-400 font-bold">INIMIGA</span> para reduzir <span className="text-red-400 font-bold">-2 DP</span></>
            : <>Clique em uma unidade <span className="text-red-400 font-bold">INIMIGA</span> para aplicar o efeito</>
          }
        </p>
      )
    }
    
    return (
      <p className="text-white text-sm">
        {itemSelectionMode.chosenOption === "buff"
          ? <>Clique em <span className="text-cyan-400 font-bold">Fehnon Hoskie</span> ou <span className="text-cyan-400 font-bold">Jaden Hainaegi</span> para receber <span className="text-green-400 font-bold">+2 DP</span></>
          : <>Clique em uma unidade <span className="text-cyan-400 font-bold">SUA</span> para aplicar o efeito</>
        }
      </p>
    )
  })()}
            <Button
              onClick={cancelItemSelection}
              size="sm"
              variant="outline"
              className="mt-4 bg-transparent text-white border-white/50 hover:bg-white/10 pointer-events-auto"
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default DuelScreen
