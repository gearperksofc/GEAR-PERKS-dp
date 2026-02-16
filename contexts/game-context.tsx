"use client"

import { createContext, useContext, useState, type ReactNode, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"

export interface Card {
  id: string
  name: string
  image: string
  rarity: "R" | "SR" | "UR" | "LR"
  type: "unit" | "troops" | "magic" | "action" | "ultimateGear" | "ultimateGuardian" | "ultimateElemental" | "item" | "scenario"
  element: "Aquos" | "Ventus" | "Pyrus" | "Terra" | "Darkus" | "Haos"
  dp: number
  ability: string
  abilityDescription: string
  attack: string
  attackDescription?: string
  category: string
  requiresEquip?: string
  requiresUnit?: string
}

export interface Playmat {
  id: string
  name: string
  image: string
  description: string
}

export interface Deck {
  id: string
  name: string
  cards: Card[]
  playmatId?: string
  useGlobalPlaymat?: boolean
}

export interface MatchRecord {
  id: string
  date: string
  opponent: string
  mode: "bot" | "player"
  result: "won" | "lost"
  deckUsed: string
}

export interface GiftBox {
  id: string
  title: string
  message: string
  cardId?: string
  coinsReward?: number
  playmatId?: string
  claimed: boolean
}

export interface Friend {
  id: string
  name: string
  avatarUrl?: string
  title?: string
  level: number
  mainUnit?: Card
  showcaseCards: Card[]
  affinityLevel: number
  affinityPoints: number
  lastHeartSent?: string
  lastHeartReceived?: string
  isGuest: boolean
  likes: number
}

export interface FriendRequest {
  id: string
  fromId: string
  fromName: string
  fromAvatarUrl?: string
  timestamp: string
  status: "pending" | "accepted" | "rejected"
}

export interface PlayerProfile {
  id: string
  name: string
  title: string
  level: number
  avatarUrl?: string
  mainUnit?: Card
  showcaseCards: Card[]
  hasCompletedSetup?: boolean
}

// Available profile icons
export const PROFILE_ICONS = [
  { id: "hrotti", name: "Hrotti", image: "/images/icons/hrotti-icon.png" },
  { id: "tsubasa", name: "Tsubasa", image: "/images/icons/tsubasa-icon.png" },
  { id: "morgana", name: "Morgana", image: "/images/icons/morgana-icon.png" },
  { id: "jaden", name: "Jaden", image: "/images/icons/jaden-icon.png" },
  { id: "uller", name: "Uller", image: "/images/icons/uller-icon.png" },
  { id: "fehnon", name: "Fehnon", image: "/images/icons/fehnon-icon.png" },
]

export interface AccountAuth {
  isLoggedIn: boolean
  email: string | null
  uniqueCode: string | null
  lastSaved: string | null
}

interface GameContextType {
  coins: number
  setCoins: (coins: number) => void
  collection: Card[]
  addToCollection: (cards: Card[]) => void
  decks: Deck[]
  saveDeck: (deck: Deck) => void
  deleteDeck: (deckId: string) => void
  matchHistory: MatchRecord[]
  addMatchRecord: (record: MatchRecord) => void
  allCards: Card[]
  giftBoxes: GiftBox[]
  claimGift: (giftId: string) => Card | null
  addGift: (gift: Omit<GiftBox, "id" | "claimed">) => void
  hasUnclaimedGifts: boolean
  playerId: string
  playerProfile: PlayerProfile
  updatePlayerProfile: (updates: Partial<PlayerProfile>) => void
  friends: Friend[]
  friendRequests: FriendRequest[]
  friendPoints: number
  spendableFP: number
  sendFriendRequest: (targetId: string) => boolean
  acceptFriendRequest: (requestId: string) => void
  rejectFriendRequest: (requestId: string) => void
  sendHeart: (friendId: string) => boolean
  sendHeartToAll: () => number
  likeFriendShowcase: (friendId: string) => void
  spendFriendPoints: (amount: number) => boolean
  searchPlayerById: (id: string) => Friend | null
  getGhostPlayers: (count: number) => Friend[]
  canSendHeartTo: (friendId: string) => boolean
  accountAuth: AccountAuth
  loginAccount: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  registerAccount: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  loginWithCode: (code: string, password: string) => Promise<{ success: boolean; error?: string }>
  registerWithCode: (password: string) => Promise<{ success: boolean; error?: string; code?: string }>
  linkEmailToCode: (email: string) => Promise<{ success: boolean; error?: string }>
  logoutAccount: () => void
  saveProgressManually: () => void
  allPlaymats: Playmat[]
  ownedPlaymats: Playmat[]
  globalPlaymatId: string | null
  setGlobalPlaymat: (playmatId: string | null) => void
  getPlaymatForDeck: (deck: Deck) => Playmat | null
  redeemCode: (code: string) => { success: boolean; message: string }
  redeemedCodes: string[]
  deleteAccountData: () => Promise<{ success: boolean; error?: string }>
  mobileMode: boolean
  setMobileMode: (enabled: boolean) => void
}

const GameContext = createContext<GameContextType | undefined>(undefined)

// Generate unique player ID
const generatePlayerId = () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  let id = "GP-"
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return id
}

const DEFAULT_GUEST_FRIEND: Friend = {
  id: "GUEST-001",
  name: "[GUEST] Sakura",
  avatarUrl: "/images/cards/vivian-20sr.png",
  title: "Iniciante Dedicado",
  level: 15,
  mainUnit: undefined,
  showcaseCards: [],
  affinityLevel: 1,
  affinityPoints: 0,
  isGuest: true,
  likes: 0,
}

// Ghost players for when user doesn't have enough friends
const GHOST_PLAYERS: Friend[] = [
  {
    id: "GHOST-001",
    name: "[GUEST] Rei",
    title: "Mestre das Chamas",
    level: 25,
    showcaseCards: [],
    affinityLevel: 1,
    affinityPoints: 0,
    isGuest: true,
    likes: 0,
  },
  {
    id: "GHOST-002",
    name: "[GUEST] Yuki",
    title: "Guardiao do Gelo",
    level: 30,
    showcaseCards: [],
    affinityLevel: 1,
    affinityPoints: 0,
    isGuest: true,
    likes: 0,
  },
  {
    id: "GHOST-003",
    name: "[GUEST] Kaito",
    title: "Senhor dos Ventos",
    level: 28,
    showcaseCards: [],
    affinityLevel: 1,
    affinityPoints: 0,
    isGuest: true,
    likes: 0,
  },
  {
    id: "GHOST-004",
    name: "[GUEST] Hana",
    title: "Princesa da Terra",
    level: 22,
    showcaseCards: [],
    affinityLevel: 1,
    affinityPoints: 0,
    isGuest: true,
    likes: 0,
  },
  {
    id: "GHOST-005",
    name: "[GUEST] Akira",
    title: "Sombra Eterna",
    level: 35,
    showcaseCards: [],
    affinityLevel: 1,
    affinityPoints: 0,
    isGuest: true,
    likes: 0,
  },
]

// All available cards in the game
const ALL_CARDS: Card[] = [
  {
    id: "vivian-r",
    name: "Vivian: A Dama do Lago",
    image: "/images/vivian-20r.png",
    rarity: "R",
    type: "troops",
    element: "Aquos",
    dp: 1,
    ability: "Abraço das Profundezas",
    abilityDescription:
      "Quando ela for evocada, você pode escolher uma unidade de 2 ou 3DP do seu deck, e evoca-la no seu campo.",
    attack: "Vapor de Avalon",
    category: "Aquos Troops unit",
  },
  {
    id: "vivian-sr",
    name: "Vivian: A Dama do Lago",
    image: "/images/vivian-20sr.png",
    rarity: "SR",
    type: "troops",
    element: "Aquos",
    dp: 1,
    ability: "Abraço das Profundezas",
    abilityDescription:
      "Quando ela for evocada, você pode escolher uma unidade de 2 ou 3DP do seu deck, e evoca-la no seu campo.",
    attack: "Vapor de Avalon",
    category: "Aquos Troops unit",
  },
  {
    id: "cavaleiro-verde-r",
    name: "O Cavaleiro Verde",
    image: "/images/o-20cavaleiro-20verde-20r.png",
    rarity: "R",
    type: "troops",
    element: "Ventus",
    dp: 1,
    ability: "Clareira Sagrada",
    abilityDescription:
      "Se ele for evocado por alguma outra carta, seja unidade ou não, ele ganha +3DP e você pode comprar uma carta.",
    attack: "Provação Eterna",
    category: "Ventus Troops unit",
  },
  {
    id: "cavaleiro-verde-sr",
    name: "O Cavaleiro Verde",
    image: "/images/o-20cavaleiro-20verde-20sr.png",
    rarity: "SR",
    type: "troops",
    element: "Ventus",
    dp: 1,
    ability: "Clareira Sagrada",
    abilityDescription:
      "Se ele for evocado por alguma outra carta, seja unidade ou não, ele ganha +3DP e você pode comprar uma carta.",
    attack: "Provação Eterna",
    category: "Ventus Troops unit",
  },
  {
    id: "cavaleiro-afogado-r",
    name: "O Caveiro Afogado",
    image: "/images/o-20cavaleiro-20afogado-20r.png",
    rarity: "R",
    type: "troops",
    element: "Aquos",
    dp: 1,
    ability: "Juramento Submerso",
    abilityDescription: "Se ele for evocado por alguma outra carta sendo unidade ou não, Você compra uma carta.",
    attack: "Afogamento Eterno",
    category: "Aquos Troops unit",
  },
  {
    id: "cavaleiro-afogado-sr",
    name: "O Caveiro Afogado",
    image: "/images/o-20cavaleiro-20afogado-20sr.png",
    rarity: "SR",
    type: "troops",
    element: "Aquos",
    dp: 1,
    ability: "Juramento Submerso",
    abilityDescription: "Se ele for evocado por alguma outra carta sendo unidade ou não, Você compra uma carta.",
    attack: "Afogamento Eterno",
    category: "Aquos Troops unit",
  },
  {
    id: "ullr-sr",
    name: "Scandinavian Angel Ullr",
    image: "/images/ullr-20sr.png",
    rarity: "SR",
    type: "unit",
    element: "Ventus",
    dp: 2,
    ability: "Marca da Caçada",
    abilityDescription:
      "Ullr escolhe uma unidade do oponente como alvo, se for do elemento Ventus, ela perde 2DP, se for de outro elemento perde 1DP.",
    attack: "Veredito de Ullr",
    attackDescription:
      "Ao atacar, alguma unidade, ou diretamente o oponente, Compre uma carta, se for uma unidade do elemento Ventus, compre mais uma.",
    category: "Ventus Ultimate Gear user",
  },
  {
    id: "ullr-ur",
    name: "Scandinavian Angel Ullr",
    image: "/images/ullr-20ur.png",
    rarity: "UR",
    type: "unit",
    element: "Ventus",
    dp: 3,
    ability: "Juramento Eterno",
    abilityDescription:
      "Todos do elemento vento ganham mais 2DP, caso Ullr estiver usando a UG: Ullrbogi, serão 3DP, essa habilidade pode ser aplicada nele também, ela pode ser ativada a cada 4 turnos.",
    attack: "Flecha de Skadi",
    attackDescription:
      "Ele pode destruir qualquer unidade que tenha 2DP no total, esse efeito pode ser ativado somente uma vez",
    category: "Ventus Ultimate Gear user",
  },
  {
    id: "mr-p-r",
    name: "O Lorde Penguim Mr. P",
    image: "/images/mr.png",
    rarity: "R",
    type: "troops",
    element: "Aquos",
    dp: 1,
    ability: "Manuscrito de Guerra",
    abilityDescription:
      "(Se quiser) Selecione uma unidade do campo do seu oponente e diminua 2DP dela. Selecione uma carta da mão do seu oponente e faça-o descarta-la.",
    attack: "A Pena é Mais Forte que a Espada",
    category: "Aquos Troops unit",
  },
  {
    id: "mr-p-sr",
    name: "O Lorde Penguim Mr. P",
    image: "/images/mr.png",
    rarity: "SR",
    type: "troops",
    element: "Aquos",
    dp: 1,
    ability: "Manuscrito de Guerra",
    abilityDescription:
      "(Se quiser) Selecione uma unidade do campo do seu oponente e diminua 2DP dela. Selecione uma carta da mão do seu oponente e faça-o descarta-la.",
    attack: "A Pena é Mais Forte que a Espada",
    category: "Aquos Troops unit",
  },
  {
    id: "morgana-sr",
    name: "Morgana Pendragon",
    image: "/images/morgana-20sr.png",
    rarity: "SR",
    type: "unit",
    element: "Darkus",
    dp: 2,
    ability: "Acorde do Abismo",
    abilityDescription:
      "Toda vez que Morgana causa dano a um oponente diretamente, ela drena uma pequena quantidade de vida (1DP) para a vida do jogador. Se o oponente tiver uma unidade do elemento Luz em campo, a drenagem é dobrada (2DP).",
    attack: "Ressonância em Eclipse",
    attackDescription:
      "Se a unidade ou o oponente sobreviver a este ataque, ele fica impedido de sacar cartas ou ativar habilidades no próximo turno dele, esse efeito pode ser ativado a cada 2 turnos.",
    category: "Darkness Ultimate Gear user",
  },
  {
    id: "morgana-ur",
    name: "Morgana Pendragon",
    image: "/images/morgana-20ur.png",
    rarity: "UR",
    type: "unit",
    element: "Darkus",
    dp: 3,
    ability: "Domínio Eterno",
    abilityDescription:
      "Enquanto essa carta estiver em campo, o oponente não pode ativar cartas armadilhas. Se essa carta for removida do campo, o oponente perde 3PV",
    attack: "Sinfonia Relâmpago",
    attackDescription:
      "A cada 3 turnos ela pode destruir duas cartas de Action ou Armadilhas Correntes do oponente. Para cada carta destruída por este efeito, o oponente deve descartar as 3 cartas do topo do deck dele diretamente para o cemitério.",
    category: "Darkness Ultimate Gear user",
  },
  {
    id: "logi-ur",
    name: "Scandinavian Angel Logi",
    image: "/images/logi-20ur.png",
    rarity: "UR",
    type: "unit",
    element: "Pyrus",
    dp: 3,
    ability: "Cinzas do Mundo",
    abilityDescription:
      "Quando ele entrar em campo, você pode escolher uma unidade de qualquer elemento (sem ser essa) e adicionar 2DP a ela permanentemente, se não tiver nenhuma outra unidade fora essa, compre uma carta.",
    attack: "Devorar o Mundo",
    attackDescription:
      "Antes dele atacar, todas as cartas de unidades do openente perdem 2DP (Se ficarem com 0 serão destruídas), se ainda ficarem com DP, ficarão permanente com o DP diminuído, esse efeito é ativado a cada 3 turnos de batalha do jogador.",
    category: "Fire Ultimate Gear user",
  },
  {
    id: "oswin-r",
    name: "Oswin: O Comerciante",
    image: "/images/oswin-20r.png",
    rarity: "R",
    type: "unit",
    element: "Darkus",
    dp: 1,
    ability: "Lucro na Crise",
    abilityDescription:
      "Puxe 5 cartas do seu baralho, se tiver cartas de itens, escolha até duas dessas cartas para adiciona-las a sua mão, o resto das cartas você irá deixa-las abaixo do seu baralho, sendo elas as ultimas a serem compradas, Caso não tenha, escolha 1 carta dessas. Essa habilidade só pode ser ativada uma vez por duelo.",
    attack: "Arremesso de Mercadorias",
    category: "Darkness Troops unit",
  },
  {
    id: "oswin-sr",
    name: "Oswin: O Comerciante",
    image: "/images/oswin-20sr.png",
    rarity: "SR",
    type: "unit",
    element: "Darkus",
    dp: 1,
    ability: "Lucro na Crise",
    abilityDescription:
      "Puxe 5 cartas do seu baralho, se tiver cartas de itens, escolha até duas dessas cartas para adiciona-las a sua mão, o resto das cartas você irá deixa-las abaixo do seu baralho, sendo elas as ultimas a serem compradas, Caso não tenha, escolha 1 carta dessas. Essa habilidade só pode ser ativada uma vez por duelo.",
    attack: "Arremesso de Mercadorias",
    category: "Darkness Troops unit",
  },
  {
    id: "mordred-r",
    name: "Mordred: O Usurpador",
    image: "/images/mordred-20r.png",
    rarity: "R",
    type: "unit",
    element: "Haos",
    dp: 1,
    ability: "Destino de Camlann",
    abilityDescription:
      "Compre uma carta, se ela for uma unidade de tropa, Mordred ganha +2DP. Essa habilidade só pode ser ativada uma vez por duelo.",
    attack: "Traição do Rei Caído",
    category: "Lightness Troops unit",
  },
  {
    id: "mordred-sr",
    name: "Mordred: O Usurpador",
    image: "/images/mordred-20sr.png",
    rarity: "SR",
    type: "unit",
    element: "Haos",
    dp: 1,
    ability: "Destino de Camlann",
    abilityDescription:
      "Compre uma carta, se ela for uma unidade de tropa, Mordred ganha +2DP. Essa habilidade só pode ser ativada uma vez por duelo.",
    attack: "Traição do Rei Caído",
    category: "Lightness Troops unit",
  },
  {
    id: "merlin-r",
    name: "Merlin: O Mago do Destino",
    image: "/images/merlin-20r.png",
    rarity: "R",
    type: "unit",
    element: "Darkus",
    dp: 1,
    ability: "Visão Além do Agora",
    abilityDescription:
      "Puxe 5 cartas do seu baralho, escolha duas dessas cartas para adiciona-las a sua mão, o resto das cartas você irá deixa-las abaixo do seu baralho, sendo elas as ultimas a serem compradas. Essa habilidade só pode ser ativada uma vez por duelo.",
    attack: "Feitiço da Eternidade",
    category: "Darkness Troops unit",
  },
  {
    id: "merlin-sr",
    name: "Merlin: O Mago do Destino",
    image: "/images/merlin-20sr.png",
    rarity: "SR",
    type: "unit",
    element: "Darkus",
    dp: 1,
    ability: "Visão Além do Agora",
    abilityDescription:
      "Puxe 5 cartas do seu baralho, escolha duas dessas cartas para adiciona-las a sua mão, o resto das cartas você irá deixa-las abaixo do seu baralho, sendo elas as ultimas a serem compradas. Essa habilidade só pode ser ativada uma vez por duelo.",
    attack: "Feitiço da Eternidade",
    category: "Darkness Troops unit",
  },
  {
    id: "logi-sr",
    name: "Scandinavian Angel Logi",
    image: "/images/logi-20sr.png",
    rarity: "SR",
    type: "unit",
    element: "Pyrus",
    dp: 2,
    ability: "Incêndio Vivo",
    abilityDescription:
      "Cada unidade do oponente que ele derrota, é mais uma vez que ele pode atacar sendo unidade do oponente, ou diretamente, essa habilidade está ativa sempre que essa carta estiver em campo batalhando.",
    attack: "Explosão de Muspell",
    attackDescription:
      "Após ele usar esse ataque, você pode escolher uma unidade de fogo do seu campo em batalha, e adicionar 1DP a ela, esse efeito dura até o final dessa fase de batalha desse turno.",
    category: "Fire Ultimate Gear user",
  },
  {
    id: "hrotti-lr",
    name: "Scandinavian Angel Hrotti",
    image: "/images/hrotti-20lr.png",
    rarity: "LR",
    type: "ultimateGuardian",
    element: "Aquos",
    dp: 4,
    ability: "Ira Maelstrom",
    abilityDescription:
      "Condição: Após causar dano de batalha ao oponente. Efeito: O oponente é forçado a colocar a carta do topo de seu Deck como a última carta de seu Deck. Além disso, você pode olhar a carta do topo do seu próprio Deck e colocá-la na parte inferior ou mantê-la onde está.",
    attack: "Tidal of Midgard",
    attackDescription:
      "Enquanto esta carta estiver no campo, o oponente não pode ativar Habilidades, Magias ou Armadilhas durante a sua Fase Principal 1 e Fase de Batalha. Esse efeito ativa na primeira fase de batalha do jogador que essa carta estiver em campo, esse efeito dura por 4 turnos.",
    category: "Aquos Ultimate Guardian user",
    requiresEquip: "MESSIHAM",
  },
  {
    id: "hrotti-ur",
    name: "Scandinavian Angel Hrotti",
    image: "/images/hrotti-20ur.png",
    rarity: "UR",
    type: "ultimateElemental",
    element: "Aquos",
    dp: 3,
    ability: "Herança de Andvaranaut",
    abilityDescription:
      "Todas as Ultimates Gears tem seus efeitos anulados por 3 turnos. Essa habilidade pode ser ativada somente uma vez.",
    attack: "Fafnisbani",
    attackDescription:
      "Quando Hrotti declara um ataque: Se a carta de unidade que ele atacar tiver 3 ou menos de DP total, essa carta ganha +2DP permanentemente, antes do ataque ser realizado, esse efeito será ativado.",
    category: "Aquos Ultimate Elemental user",
  },
  {
    id: "hrotti-sr",
    name: "Scandinavian Angel Hrotti",
    image: "/images/hrotti-20sr.png",
    rarity: "SR",
    type: "unit",
    element: "Aquos",
    dp: 2,
    ability: "Avareza de Fafnir",
    abilityDescription:
      "A cada 3 turnos, você pode descartar cartas do seu campo (qualquer tipo de carta ativa em seu campo) para conceder a Hrotti um bônus de DP dependendo de quantas cartas forem descartadas (1DP para cada)",
    attack: "Corte do Medo Rúnico",
    attackDescription:
      "Na fase de batalha, antes de Hrotti atacar, todas as unidades do oponente independente do elemento, perdem 1DP, essa habilidade é ativada a cada 2 turnos na fase de batalha do jogador.",
    category: "Aquos Ultimate Gear user",
  },
  {
    id: "galahad-sr",
    name: "Santo Graal: Galahad",
    image: "/images/galahad-20sr.png",
    rarity: "SR",
    type: "unit",
    element: "Haos",
    dp: 1,
    ability: "Coração Imaculado",
    abilityDescription:
      "Enquanto estiver em campo, Galahad não pode ser destruído por cartas do oponente, exceto se unidades do oponente forem ataca-lo.",
    attack: "Lâmina da Pureza",
    category: "Lightness Troops unit",
  },
  {
    id: "jaden-lr",
    name: "Jaden Hainaegi",
    image: "/images/jaden-20lr.png",
    rarity: "LR",
    type: "ultimateGuardian",
    element: "Pyrus",
    dp: 4,
    ability: "Magma Primordial",
    abilityDescription:
      "Causa 3 DP de dano direto ao oponente. Esse dano ignora qualquer carta, efeito ou condição, e não pode ser prevenido. Só pode ser ativada uma única vez por duelo.",
    attack: "Sol Carmesim",
    attackDescription:
      "Se esse ataque derrotar uma unidade, cause 2 DP de dano direto adicional ao oponente. Na fase de batalha do turno seguinte, todas as outras unidades inimigas recebem a mesma quantidade de dano (2DP) no próximo turno.",
    category: "Fire Ultimate Guardian user",
    requiresEquip: "IFRAID",
  },
  {
    id: "jaden-ur",
    name: "Jaden Hainaegi",
    image: "/images/jaden-20ur.png",
    rarity: "UR",
    type: "ultimateElemental",
    element: "Pyrus",
    dp: 3,
    ability: "Neo Núcleo",
    abilityDescription:
      "No início do turno do seu controlador, você pode ativar este efeito: Escolha 1 unidade inimiga, ela perde 1 DP. Se essa unidade for derrotada por este efeito, Jaden recebe +1DP neste turno. Pode ser ativada uma vez por turno. Não pode ser usada no turno em que Jaden entrou em campo.",
    attack: "Pressão Vulcânica",
    attackDescription:
      "Quando Jaden declara um ataque: Cause 1 DP de dano direto ao oponente antes da resolução do combate. Se o ataque<bos> derrotar a unidade inimiga, Jaden ganha +1DP",
    category: "Fire Ultimate Elemental user",
  },
  {
    id: "jaden-sr",
    name: "Jaden Hainaegi",
    image: "/images/jaden-20sr.png",
    rarity: "SR",
    type: "unit",
    element: "Pyrus",
    dp: 2,
    ability: "Núcleo Ardente",
    abilityDescription:
      "Causa dano de 2DP direto ignorando qualquer tipo de carta/efeito que tente negar essa habilidade. Ela só pode ser ativada uma única vez em um duelo.",
    attack: "Impacto Carmesim",
    attackDescription:
      "Se derrotar um inimigo, Jaden pode atacar novamente uma unidade do oponente ou atacá-lo diretamente.",
    category: "Fire Ultimate Elemental user",
  },
  {
    id: "arthur-lr",
    name: "Rei Arthur",
    image: "/images/arthur-20lr.png",
    rarity: "LR",
    type: "ultimateGuardian",
    element: "Darkus",
    dp: 4,
    ability: "O Preço da Coroa",
    abilityDescription:
      "Unidades inimigas com 5 ou 6 de DP, não podem declarar ataque contra ele. Quando essa carta for jogada, você tem a opção de comprar uma carta.",
    attack: "Cálice do Monarca",
    attackDescription:
      "Antes de declarar um ataque, você pode escolher descartar uma carta da sua mão, caso descarte, você pode escolher duas unidades do oponente como alvo, e destruí-las. Se a carta que você descartou foi uma magia, essa unidade ganha +2DP. Esse efeito só pode ser usado a cada 2 turnos.",
    category: "Darkness Ultimate Guardian user",
    requiresEquip: "MEFISTO",
  },
  {
    id: "arthur-ur",
    name: "Rei Arthur",
    image: "/images/arthur-20ur.png",
    rarity: "UR",
    type: "ultimateGuardian",
    element: "Darkus",
    dp: 3,
    ability: "Presença Esmagadora",
    abilityDescription: "Unidades inimigas com 3 ou 4 de DP, não podem declarar ataque contra ele.",
    attack: "Veredito do Rei Tirano",
    attackDescription:
      "Antes de declarar um ataque, você pode escolher descartar uma carta da sua mão, caso descarte, você pode escolher uma unidade do oponente como alvo, e destruí-la. Esse efeito só pode ser usado a cada 2 turnos.",
    category: "Darkness Ultimate Guardian user",
  },
  {
    id: "arthur-sr",
    name: "Rei Arthur",
    image: "/images/arthur-20sr.png",
    rarity: "SR",
    type: "ultimateElemental",
    element: "Darkus",
    dp: 2,
    ability: "Soberania das Sombras",
    abilityDescription:
      "Enquanto essa carta estiver no campo, seu oponente não pode ativar cartas com efeitos de 'Cura'.",
    attack: "Eclipse de Avalon",
    attackDescription: "Se esse ataque derrotar uma unidade, cause 3 DP de dano direto adicional ao oponente.",
    category: "Darkness Ultimate Elemental user",
  },
  {
    id: "galahad-r",
    name: "Santo Graal: Galahad",
    image: "/images/galahad-20r.png",
    rarity: "R",
    type: "unit",
    element: "Haos",
    dp: 1,
    ability: "Coração Imaculado",
    abilityDescription:
      "Enquanto estiver em campo, Galahad não pode ser destruído por cartas do oponente, exceto se unidades do oponente forem ataca-lo.",
    attack: "Lâmina da Pureza",
    category: "Lightness Troops unit",
  },
  {
    id: "fehnon-ur",
    name: "Fehnon Hoskie",
    image: "/images/fehnon-20ur.png",
    rarity: "UR",
    type: "unit",
    element: "Aquos",
    dp: 3,
    ability: "Singularidade Zero",
    abilityDescription:
      "Ruptura: Enquanto este card estiver equipado com UG: Protonix Sword, ele pode realizar até dois ataques durante cada Fase de Batalha. Sempre que este personagem destruir uma unidade do oponente em batalha, ele recebe +2 DP até o final do turno.",
    attack: "Ordem de Laceração",
    attackDescription:
      "Ao declarar um ataque: compre 1 card. Se for uma Unidade, este personagem pode atacar novamente e o oponente não pode ativar efeitos em resposta a este ataque.",
    category: "Aquos Ultimate Gear user",
  },
  {
    id: "fehnon-sr",
    name: "Fehnon Hoskie",
    image: "/images/fehnon-20sr.png",
    rarity: "SR",
    type: "unit",
    element: "Aquos",
    dp: 2,
    ability: "Fluxo de Ruptura",
    abilityDescription:
      "Quando ele derrota em batalha uma unidade do oponente, cause 2DP como dano extra na vida do oponente por unidade derrotada, essa habilidade pode ser ativada toda vez que ele derrotar uma unidade do oponente.",
    attack: "Laceração",
    attackDescription:
      "Quando ele ataca, tanto uma unidade do oponente, quanto diretamente, compre uma carta, se for uma carta de unidade, ele pode atacar novamente.",
    category: "Aquos Ultimate Gear user",
  },
  {
    id: "ullrbogi",
    name: "Ultimate Gear: Ullrbogi",
    image: "/images/ullrbogi.png",
    rarity: "UR",
    type: "ultimateGear",
    element: "Ventus",
    dp: 0,
    ability: "ULLRBOGI",
    abilityDescription: "Somente quando Ullr está equipado com esta arma, ele ganha mais 3DP em todos os momentos das fases de batalha do jogador",
    attack: "",
    category: "Ventus Ultimate Gear",
    requiresUnit: "Scandinavian Angel Ullr",
  },
  {
    id: "twiligh-avalon",
    name: "Ultimate Gear: Twiligh Avalon",
    image: "/images/twiligh-20avalon.png",
    rarity: "UR",
    type: "ultimateGear",
    element: "Darkus",
    dp: 0,
    ability: "TWILIGH AVALON",
    abilityDescription: "Quando equipada em Morgana, a Twiligh Avalon concede os seguintes efeitos: Morgana ganha +2DP, Você pode selecionar e devolver 1 Card do campo do seu oponente para a mão dele, Se o Card devolvido for uma unidade, cause 3DP de dano direto aos LP do oponente, essa segunda habilidade pode ser ativada somente uma única vez.",
    attack: "",
    category: "Darkness Ultimate Gear",
    requiresUnit: "Morgana Pendragon",
  },
  {
    id: "oden-sword",
    name: "Ultimate Gear: Oden Sword",
    image: "/images/oden-20sword.png",
    rarity: "UR",
    type: "ultimateGear",
    element: "Aquos",
    dp: 0,
    ability: "ODEN SWORD",
    abilityDescription: "Quando equipada em Fehnon Hoskie, a Oden Sword concede os seguintes efeitos: Fehnon ganha +4DP, Você pode selecionar e destruir um Card de Função do campo do seu oponente, essa segunda habilidade pode ser ativada somente uma única vez.",
    attack: "",
    category: "Aquos Ultimate Gear",
    requiresUnit: "Fehnon Hoskie",
  },
  {
    id: "protonix-sword",
    name: "Ultimate Gear: Protonix Sword",
    image: "/images/protonix-20sword.png",
    rarity: "SR",
    type: "ultimateGear",
    element: "Aquos",
    dp: 0,
    ability: "PROTONIX SWORD",
    abilityDescription: "Enquanto esta carta estiver equipada, o Fehnon Hoskie recebe +2 DP adicional.",
    attack: "",
    category: "Aquos Ultimate Gear",
    requiresUnit: "Fehnon Hoskie",
  },
  {
    id: "fornbrenna",
    name: "Ultimate Gear: Fornbrenna",
    image: "/images/fornbrenna.png",
    rarity: "UR",
    type: "ultimateGear",
    element: "Pyrus",
    dp: 0,
    ability: "FORNBRENNA",
    abilityDescription: "Somente quando Logi está equipado com esta arma, ele ganha mais 2DP a cada carta de unidade de fogo que já foi usada pelo jogador, cartas evocadas depois não serão incluídas.",
    attack: "",
    category: "Fire Ultimate Gear",
    requiresUnit: "Scandinavian Angel Logi",
  },
  // SCENARIO CARDS
  {
    id: "reino-de-camelot",
    name: "Reino de Camelot",
    image: "/images/reino-de-camelot.png",
    rarity: "UR",
    type: "scenario",
    element: "Darkus",
    dp: 0,
    ability: "REINO DE CAMELOT",
    abilityDescription: "Efeito para determinadas cartas de unidades destacadas: Unidades da Irmandade ALVORADA DE AVALON e Unidades do Elemento DARK. Unidades da ALVORADA DE AVALON recebem +3DP. Unidades do Elemento DARK recebem +2DP. Demais Unidades do oponente perdem -2DP. Se uma carta for da Irmandade, mas também for do elemento destacado, ele receberá apenas o Efeito da Irmandade.",
    attack: "",
    category: "Scenario Card",
  },
  {
    id: "arena-escandinava",
    name: "Arena Escandinava",
    image: "/images/arena-escandinava.png",
    rarity: "UR",
    type: "scenario",
    element: "Haos",
    dp: 0,
    ability: "ARENA ESCANDINAVA",
    abilityDescription: "Efeito para determinadas cartas de unidades destacadas: Unidades da Irmandade SCANDINAVIAN ANGELS, ou no caso tendo Scandinavian Angels em seu nome. Unidades da SCANDINAVIAN ANGELS recebem +3DP. Compre uma carta quando esse Scenario for jogado no seu campo. Demais Unidades do oponente perdem -1DP.",
    attack: "",
    category: "Scenario Card",
  },
  {
    id: "vila-da-polvora",
    name: "Vila da Pólvora",
    image: "/images/vila-da-polvora.png",
    rarity: "UR",
    type: "scenario",
    element: "Pyrus",
    dp: 0,
    ability: "VILA DA PÓLVORA",
    abilityDescription: "Efeito para determinadas cartas de unidades destacadas: Unidades da Irmandade TORMENTA PROMINENCE e Unidades do Elemento FIRE. Unidades da TORMENTA PROMINENCE recebem +2DP. Unidades do Elemento FIRE recebem +1DP. Demais Unidades do oponente perdem -3DP. Se uma carta for da Irmandade, mas também for do elemento destacado, ele receberá apenas o Efeito da Irmandade.",
    attack: "",
    category: "Scenario Card",
  },
  {
    id: "ruinas-abandonadas",
    name: "Ruínas Abandonadas",
    image: "/images/ruinas-abandonadas.png",
    rarity: "UR",
    type: "scenario",
    element: "Haos",
    dp: 0,
    ability: "RUÍNAS ABANDONADAS",
    abilityDescription: "Efeito para determinadas cartas de unidades destacadas: Unidades da Irmandade THE GREAT ORDER e Unidades Tropas. Unidades da THE GREAT ORDER recebem +2DP. Unidades Tropas recebem +2DP. Compre uma carta quando esse Scenario for jogado no seu campo. Se uma carta for da Irmandade, mas também for tropa, ele receberá apenas o Efeito da Irmandade.",
    attack: "",
    category: "Scenario Card",
  },
  {
  id: "bandagens-duplas",
  name: "Bandagens Duplas",
    image: "/images/bandagens-duplas.png",
    rarity: "R",
    type: "item",
    element: "Haos",
    dp: 0,
    ability: "Cura",
    abilityDescription: "Essa carta cura 4LP do jogador de dano já sofrido.",
    attack: "",
    category: "Item Funcion Card",
  },
  {
    id: "bandagem-restauradora",
    name: "Bandagem Restauradora",
    image: "/images/bandagem-restauradora.png",
    rarity: "R",
    type: "item",
    element: "Haos",
    dp: 0,
    ability: "Cura",
    abilityDescription: "Essa carta cura 2LP do jogador de dano já sofrido.",
    attack: "",
    category: "Item Funcion Card",
  },
  {
    id: "cristal-recuperador",
    name: "Cristal Recuperador",
    image: "/images/cristal-recuperador.png",
    rarity: "R",
    type: "item",
    element: "Haos",
    dp: 0,
    ability: "Cura Avançada",
    abilityDescription:
      "Essa carta cura 3LP do jogador de dano já sofrido, em seguida compre uma carta, se for de Funcion, ela cura +1DP do jogador.",
    attack: "",
    category: "Item Funcion Card",
  },
  {
    id: "dados-elementais-alpha",
    name: "Dados Elementais Alpha",
    image: "/images/dados-elementais-alpha.png",
    rarity: "SR",
    type: "item",
    element: "Darkus",
    dp: 0,
    ability: "Rolagem Elemental",
    abilityDescription:
      "Jogue um dado (efeito bônus se for do elemento específico): 1-2: uma unidade sua ganha +3DP. Se for (Darkness): compre +1 carta. 3-4: uma unidade sua ganha +4DP. Se for (Fire): você ganha +2LP. 5-6: uma unidade sua ganha +5DP. Se for (Aquos): você ganha +3LP. Requer uma carta de unidade dos elementos (Darkness, Fire ou Aquos). Se você tiver e não cair no elemento da sua unidade, essa carta não faz nada.",
    attack: "",
    category: "Item Funcion Card",
  },
  {
    id: "dados-elementais-omega",
    name: "Dados Elementais Omega",
    image: "/images/dados-elementais-omega.png",
    rarity: "SR",
    type: "item",
    element: "Haos",
    dp: 0,
    ability: "Rolagem Elemental",
    abilityDescription:
      "Jogue um dado (efeito bônus se for do elemento específico): 1-2: uma unidade sua ganha +3DP. Se for (Neutral): compre +1 carta. 3-4: uma unidade sua ganha +4DP. Se for (Lightness): você ganha +2LP. 5-6: uma unidade sua ganha +5DP e você ganha +3LP. Requer uma carta de unidade dos elementos (Neutral, Lightness ou Ventus). Se você tiver e não cair no elemento da sua unidade, nada acontece.",
    attack: "",
    category: "Item Funcion Card",
  },
  {
    id: "dados-da-calamidade",
    name: "Dados da Calamidade",
    image: "/images/dados-da-calamidade.png",
    rarity: "UR",
    type: "item",
    element: "Darkus",
    dp: 0,
    ability: "Risco e Recompensa",
    abilityDescription:
      "Jogue um dado: se cair em 1-2: uma unidade sua perde -5DP. 3-4: nada acontece. 5-6: uma unidade sua ganha +8DP, mas após 2 turnos -5DP.",
    attack: "",
    category: "Item Funcion Card",
  },
  {
    id: "dados-da-fortuna",
    name: "Dados da Fortuna",
    image: "/images/dados-da-fortuna.png",
    rarity: "R",
    type: "item",
    element: "Ventus",
    dp: 0,
    ability: "Sorte",
    abilityDescription:
      "Jogue um dado: 1-2: uma unidade sua ganha +1DP. 3-4: uma unidade sua ganha +2DP, e compre 1 carta. 5-6: uma unidade sua ganha +3DP e compre 2 cartas.",
    attack: "",
    category: "Item Funcion Card",
  },
  {
    id: "amplificador-de-poder",
    name: "Amplificador de Poder",
    image: "/images/amplificador-de-poder.png",
    rarity: "SR",
    type: "item",
    element: "Pyrus",
    dp: 0,
    ability: "Absorção de Poder",
    abilityDescription:
      "Selecione uma carta de unidade no campo do oponente, o DP Original dela é somada ao DP total de alguma carta ativa no campo do jogador.",
    attack: "",
    category: "Item Funcion Card",
  },
  {
    id: "cauda-de-dragao-assada",
    name: "Cauda de Dragão Assada",
    image: "/images/cauda-de-dragao-assada.png",
    rarity: "R",
    type: "item",
    element: "Pyrus",
    dp: 0,
    ability: "Banquete",
    abilityDescription:
      "Se você tiver 2 ou mais cartas de unidade em seu campo, todas essas unidades ganham +1DP, e você ganha +2LP total.",
    attack: "",
    category: "Item Funcion Card",
  },
  {
    id: "adaga-energizada",
    name: "Adaga Energizada",
    image: "/images/adaga-energizada.png",
    rarity: "SR",
    type: "item",
    element: "Pyrus",
    dp: 0,
    ability: "Dano Direto",
    abilityDescription: "Se o oponente tiver duas cartas de unidades no campo dele, cause 4DP diretamente aos LP dele.",
    attack: "",
    category: "Item Funcion Card",
  },
  {
    id: "dados-do-cataclismo",
    name: "Dados do Cataclismo",
    image: "/images/cards/dados-do-cataclismo.png",
    rarity: "UR",
    type: "item",
    element: "Pyrus",
    dp: 0,
    ability: "Rolagem Cataclísmica",
    abilityDescription:
      "Jogue um dado: 1-3: nenhuma unidade recebe bônus. 4-6: uma unidade sua ganha +6DP. Se sair 6, cause -3DP em uma unidade inimiga.",
    attack: "",
    category: "Item Funcion Card",
  },
  {
    id: "projetil-de-impacto",
    name: "Projétil de Impacto",
    image: "/images/cards/projetil-de-impacto.png",
    rarity: "R",
    type: "item",
    element: "Pyrus",
    dp: 0,
    ability: "Dano Direto",
    abilityDescription: "Cause 2DP diretamente aos LP do oponente.",
    attack: "",
    category: "Item Funcion Card",
  },
  {
    id: "nucleo-explosivo",
    name: "Núcleo Explosivo",
    image: "/images/cards/nucleo-explosivo.png",
    rarity: "SR",
    type: "item",
    element: "Pyrus",
    dp: 0,
    ability: "Explosão em Área",
    abilityDescription: "Cause 1 de dano a cada carta de unidade no campo do oponente.",
    attack: "",
    category: "Item Funcion Card",
  },
  {
    id: "soro-recuperador",
    name: "Soro Recuperador",
    image: "/images/cards/soro-recuperador.png",
    rarity: "R",
    type: "item",
    element: "Haos",
    dp: 0,
    ability: "Cura e Compra",
    abilityDescription: "Essa carta cura 3LP do jogador de dano já sofrido, em seguida compre uma carta.",
    attack: "",
    category: "Item Funcion Card",
  },
  {
    id: "dados-do-destino-gentil",
    name: "Dados do Destino Gentil",
    image: "/images/cards/dados-do-destino-gentil.png",
    rarity: "SR",
    type: "item",
    element: "Haos",
    dp: 0,
    ability: "Destino Incerto",
    abilityDescription:
      "Jogue um dado: se cair em 1, 2, ou 3, uma carta de unidade que você tem em campo perde -3DP. Se cair em 4, 5, ou 6, uma carta de unidade que você tem em campo ganha +5DP.",
    attack: "",
    category: "Item Funcion Card",
  },
  {
    id: "kit-medico-improvisado",
    name: "Kit Médico Improvisado",
    image: "/images/cards/kit-medico-improvisado.png",
    rarity: "R",
    type: "item",
    element: "Haos",
    dp: 0,
    ability: "Cura Avançada",
    abilityDescription:
      "Essa carta cura 2LP do jogador de dano já sofrido, em seguida compre uma carta, se for de unidade, ela cura +1DP do jogador.",
    attack: "",
    category: "Item Funcion Card",
  },
  {
    id: "ordem-de-laceracao",
    name: "Ordem de Laceração",
    image: "/images/cards/ordem-de-laceracao.png",
    rarity: "UR",
    type: "magic",
    element: "Aquos",
    dp: 0,
    ability: "Ataque Especial de Fehnon",
    abilityDescription:
      "Se estiver com Fehnon Hoskie em seu campo de batalha, use essa carta e cause 3DP diretamente no seu oponente, essa carta não pode ser negada por efeito de habilidades de cartas unidade do seu oponente.",
    attack: "",
    category: "Magic Funcion Card",
    requiresUnit: "fehnon",
  },
  {
    id: "sinfonia-relampago",
    name: "Sinfonia Relâmpago",
    image: "/images/cards/sinfonia-relampago.png",
    rarity: "UR",
    type: "magic",
    element: "Darkus",
    dp: 0,
    ability: "Ataque Especial de Morgana",
    abilityDescription:
      "Se estiver com Morgana Pendragon em seu campo de batalha, use essa carta e cause 4DP diretamente no seu oponente, essa carta não pode ser negada por armadilhas do seu oponente.",
    attack: "",
    category: "Magic Funcion Card",
    requiresUnit: "morgana",
  },
  {
    id: "fafnisbani",
    name: "Fafnisbani",
    image: "/images/cards/fafnisbani.png",
    rarity: "LR",
    type: "magic",
    element: "Aquos",
    dp: 0,
    ability: "Ataque Especial de Hrotti",
    abilityDescription:
      "Se estiver com Scandinavian Angel Hrotti em seu campo de batalha, use essa carta e cause 3DP em alguma unidade do seu oponente ou diretamente no LP dele, após isso, destrua uma carta Function do campo dele. Essa carta não pode ser negada por efeito de Ultimates Guardians do seu oponente.",
    attack: "",
    category: "Magic Funcion Card",
    requiresUnit: "hrotti",
  },
  {
    id: "devorar-o-mundo",
    name: "Devorar o Mundo",
    image: "/images/cards/devorar-o-mundo.png",
    rarity: "UR",
    type: "magic",
    element: "Pyrus",
    dp: 0,
    ability: "Ataque Especial de Logi",
    abilityDescription:
      "Se estiver com Scandinavian Angel Logi em seu campo de batalha, use essa carta e cause 4DP em alguma unidade do seu oponente ou diretamente no LP dele. Essa carta não pode ser negada por efeito de Armadilhas do seu oponente.",
    attack: "",
    category: "Magic Funcion Card",
    requiresUnit: "logi",
  },
  {
    id: "veu-dos-lacos-cruzados",
    name: "Véu dos Laços Cruzados",
    image: "/images/cards/veu-dos-lacos-cruzados.png",
    rarity: "SR",
    type: "action",
    element: "Haos",
    dp: 0,
    ability: "Laços de Amizade",
    abilityDescription:
      "Se tiver um unidade Fehnon Hoskie ou Jaden Hainaegi no seu campo, você pode escolher entre: Adicionar 2DP a uma dessas unidades no seu campo, ou diminuir 2DP de uma unidade do oponente.",
    attack: "",
    category: "Action Funcion Card",
    requiresUnit: "fehnon,jaden",
  },
]

const ALL_PLAYMATS: Playmat[] = [
  {
    id: "playmat-hrotti-water",
    name: "Hrotti: Furia Aquatica",
    image: "/images/playmats/hrotti-water.png",
    description: "O poder das aguas ancestrais flui atraves deste tapete mistico.",
  },
  {
    id: "playmat-logi-fire",
    name: "Logi: Chamas Eternas",
    image: "/images/playmats/logi-fire.png",
    description: "O fogo primordial arde eternamente neste tapete lendario.",
  },
]

const INITIAL_GIFT_BOXES: GiftBox[] = [
  {
    id: "beta-reward",
    title: "Presente de Beta Tester",
    message: "Obrigado por testar a Beta de Gear Perks!!!",
    cardId: "veu-dos-lacos-cruzados",
    claimed: false,
  },
]

export function GameProvider({ children }: { children: ReactNode }) {
  const [coins, setCoins] = useState(999)
  const [collection, setCollection] = useState<Card[]>([])
  const [decks, setDecks] = useState<Deck[]>([])
  const [matchHistory, setMatchHistory] = useState<MatchRecord[]>([])
  const [giftBoxes, setGiftBoxes] = useState<GiftBox[]>([
    {
      id: "welcome-gift",
      title: "Obrigado por testar a Beta de Gear Perks!!!",
      message: "Como agradecimento por participar da nossa beta, voce recebe esta carta exclusiva!",
      cardId: "veu-lacos-cruzados",
      claimed: false,
    },
    {
      id: "playmat-gift-water",
      title: "Presente Especial: Playmat Hrotti",
      message: "Desbloqueie o tapete de duelo Hrotti: Furia Aquatica para personalizar seu campo de batalha!",
      playmatId: "playmat-hrotti-water",
      claimed: false,
    },
    {
      id: "playmat-gift-fire",
      title: "Presente Especial: Playmat Logi",
      message: "Desbloqueie o tapete de duelo Logi: Chamas Eternas para personalizar seu campo de batalha!",
      playmatId: "playmat-logi-fire",
      claimed: false,
    },
  ])

  const [playerId, setPlayerId] = useState("")
  const [playerProfile, setPlayerProfile] = useState<PlayerProfile>({
    id: "",
    name: "Jogador",
    title: "Novato",
    level: 1,
    showcaseCards: [],
  })
  const [friends, setFriends] = useState<Friend[]>([DEFAULT_GUEST_FRIEND])
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([])
  const [friendPoints, setFriendPoints] = useState(0) // Accumulated (bar)
  const [spendableFP, setSpendableFP] = useState(0) // Spendable in gacha

  // Account Auth State
  const [accountAuth, setAccountAuth] = useState<AccountAuth>({
    isLoggedIn: false,
    email: null,
    uniqueCode: null,
    lastSaved: null,
  })

  const [ownedPlaymats, setOwnedPlaymats] = useState<Playmat[]>([])
  const [globalPlaymatId, setGlobalPlaymatId] = useState<string | null>(null)
  const [redeemedCodes, setRedeemedCodes] = useState<string[]>([])
  const [mobileMode, setMobileModeState] = useState(false)
  
  // Helper to get localStorage with fallback keys (old format vs new format)
  const getLS = (key: string): string | null => {
    // Try new format first (gear-perks-*), then old format (gearperks-*)
    return localStorage.getItem(`gear-perks-${key}`) || localStorage.getItem(`gearperks-${key}`) || null
  }
  
  // Save to localStorage with unified key format
  const setLS = (key: string, value: string) => {
    localStorage.setItem(`gearperks-${key}`, value)
    localStorage.setItem(`gear-perks-${key}`, value) // save to both for compatibility
  }

  // Load saved data from localStorage on mount, and from cloud if logged in
  useEffect(() => {
    const loadData = async () => {
      // 1. Load auth first
      const savedAuth = localStorage.getItem("gear-perks-auth")
      let auth: AccountAuth | null = null
      if (savedAuth) {
        try {
          auth = JSON.parse(savedAuth)
          if (auth) setAccountAuth(auth)
        } catch (e) {
          console.error("Failed to parse auth data")
        }
      }

      // 2. If logged in with a unique code, try loading from Supabase cloud first
      let cloudLoaded = false
      if (auth?.isLoggedIn && auth?.uniqueCode) {
        try {
          const supabase = createClient()
          const { data: profileData, error: profileError } = await supabase
            .from("player_profiles")
            .select("*")
            .eq("user_code", auth.uniqueCode)
            .single()

          if (profileData && !profileError) {
            // Load all data from cloud
            setCoins(profileData.coins ?? 999)
            setCollection(profileData.collection ?? [])
            setDecks(profileData.decks ?? [])
            setMatchHistory(profileData.duel_history ?? [])
            
            const loadedProfile: PlayerProfile = {
              id: profileData.id,
              name: profileData.player_name || "Jogador",
              title: profileData.player_title || "Iniciante",
              level: 1,
              avatarUrl: profileData.avatar_id,
              showcaseCards: [],
              hasCompletedSetup: true,
            }
            setPlayerProfile(loadedProfile)
            if (profileData.player_id) setPlayerId(profileData.player_id)

            // Sync cloud data to localStorage for offline access
            setLS("coins", (profileData.coins ?? 999).toString())
            setLS("collection", JSON.stringify(profileData.collection ?? []))
            setLS("decks", JSON.stringify(profileData.decks ?? []))
            setLS("history", JSON.stringify(profileData.duel_history ?? []))
            setLS("profile", JSON.stringify(loadedProfile))
            
            cloudLoaded = true
          }
        } catch (err) {
          console.error("Failed to load from cloud, falling back to localStorage:", err)
        }
      }

      // 3. If not loaded from cloud, load from localStorage
      if (!cloudLoaded) {
        const savedCoins = getLS("coins")
        const savedCollection = getLS("collection")
        const savedDecks = getLS("decks")
        const savedHistory = getLS("history")
        const savedProfile = getLS("profile")

        if (savedCoins) setCoins(Number.parseInt(savedCoins))
        if (savedCollection) {
          try { setCollection(JSON.parse(savedCollection)) } catch {}
        }
        if (savedDecks) {
          try { setDecks(JSON.parse(savedDecks)) } catch {}
        }
        if (savedHistory) {
          try { setMatchHistory(JSON.parse(savedHistory)) } catch {}
        }
        if (savedProfile) {
          try { setPlayerProfile(JSON.parse(savedProfile)) } catch {}
        }
      }

      // 4. Load gift boxes (always from localStorage since not in cloud)
      const savedGifts = getLS("giftboxes")
      if (savedGifts) {
        try {
          const parsed = JSON.parse(savedGifts) as GiftBox[]
          const merged = INITIAL_GIFT_BOXES.map((gift) => {
            const saved = parsed.find((p) => p.id === gift.id)
            return saved ? { ...gift, claimed: saved.claimed } : gift
          })
          const newGifts = parsed.filter((p) => !INITIAL_GIFT_BOXES.find((g) => g.id === p.id))
          setGiftBoxes([...merged, ...newGifts])
        } catch {}
      }

      // Player ID
      const savedPlayerId = getLS("playerid") || localStorage.getItem("gear-perks-player-id")
      if (savedPlayerId) {
        setPlayerId(savedPlayerId)
      } else {
        const newId = generatePlayerId()
        setPlayerId(newId)
        setLS("playerid", newId)
      }

      // Friends - ensure GUEST is always present
      const savedFriends = getLS("friends")
      if (savedFriends) {
        try {
          const parsed = JSON.parse(savedFriends) as Friend[]
          const hasGuest = parsed.some((f) => f.id === "GUEST-001")
          if (!hasGuest) {
            setFriends([DEFAULT_GUEST_FRIEND, ...parsed])
          } else {
            setFriends(parsed)
          }
        } catch {}
      }

      const savedRequests = getLS("friendrequests")
      const savedFP = getLS("fp")
      const savedSpendableFP = getLS("spendablefp")
      if (savedRequests) { try { setFriendRequests(JSON.parse(savedRequests)) } catch {} }
      if (savedFP) setFriendPoints(Number.parseInt(savedFP))
      if (savedSpendableFP) setSpendableFP(Number.parseInt(savedSpendableFP))

      // Playmats
      const savedOwnedPlaymats = localStorage.getItem("gearperks_owned_playmats")
      const savedGlobalPlaymat = localStorage.getItem("gearperks_global_playmat")
      if (savedOwnedPlaymats) {
        try {
          const playmatIds = JSON.parse(savedOwnedPlaymats)
          setOwnedPlaymats(ALL_PLAYMATS.filter((p) => playmatIds.includes(p.id)))
        } catch {}
      }
      if (savedGlobalPlaymat) {
        setGlobalPlaymatId(savedGlobalPlaymat)
      }
      
      // Redeemed codes
      const savedRedeemedCodes = getLS("redeemed-codes")
      if (savedRedeemedCodes) {
        try { setRedeemedCodes(JSON.parse(savedRedeemedCodes)) } catch {}
      }
      
      // Mobile mode
      const savedMobileMode = getLS("mobile-mode")
      if (savedMobileMode === "true") {
        setMobileModeState(true)
      }
    }

    loadData()
  }, [])

  // Save to localStorage when data changes (both key formats for compatibility)
  useEffect(() => {
    setLS("coins", coins.toString())
  }, [coins])
  
  useEffect(() => {
    setLS("collection", JSON.stringify(collection))
  }, [collection])
  
  useEffect(() => {
    setLS("decks", JSON.stringify(decks))
  }, [decks])
  
  useEffect(() => {
    setLS("history", JSON.stringify(matchHistory))
  }, [matchHistory])
  
  useEffect(() => {
    setLS("giftboxes", JSON.stringify(giftBoxes))
  }, [giftBoxes])
  
  useEffect(() => {
    if (playerId) setLS("playerid", playerId)
  }, [playerId])
  
  useEffect(() => {
    setLS("profile", JSON.stringify(playerProfile))
  }, [playerProfile])
  
  useEffect(() => {
    setLS("friends", JSON.stringify(friends))
  }, [friends])
  
  useEffect(() => {
    setLS("friendrequests", JSON.stringify(friendRequests))
  }, [friendRequests])
  
  useEffect(() => {
    setLS("fp", friendPoints.toString())
  }, [friendPoints])
  
  useEffect(() => {
    setLS("spendablefp", spendableFP.toString())
  }, [spendableFP])

  // useEffect(() => {
  //   localStorage.setItem("gearperks-accountAuth", JSON.stringify(accountAuth)) // Replaced by gear-perks-auth
  //   if (accountAuth.isLoggedIn) {
  //     setAccountAuth((prev) => ({ ...prev, lastSaved: new Date().toISOString() }))
  //   }
  // }, [accountAuth])

  // Save account auth state to localStorage
  useEffect(() => {
    localStorage.setItem("gear-perks-auth", JSON.stringify(accountAuth))
    localStorage.setItem("gearperks-accountAuth", JSON.stringify(accountAuth))
  }, [accountAuth])

  useEffect(() => {
    localStorage.setItem("gearperks_owned_playmats", JSON.stringify(ownedPlaymats.map((p) => p.id)))
  }, [ownedPlaymats])

  useEffect(() => {
    if (globalPlaymatId) {
      localStorage.setItem("gearperks_global_playmat", globalPlaymatId)
    } else {
      localStorage.removeItem("gearperks_global_playmat")
    }
  }, [globalPlaymatId])

  const addToCollection = (cards: Card[]) => {
    setCollection((prev) => [...prev, ...cards])
  }

  const saveDeck = (deck: Deck) => {
    setDecks((prev) => {
      const existingIndex = prev.findIndex((d) => d.id === deck.id)
      if (existingIndex >= 0) {
        const updated = [...prev]
        updated[existingIndex] = deck
        return updated
      }
      return [...prev, deck]
    })
  }

  const deleteDeck = (deckId: string) => {
    setDecks((prev) => prev.filter((d) => d.id !== deckId))
  }

  const addMatchRecord = (record: MatchRecord) => {
    setMatchHistory((prev) => [record, ...prev])
  }

  const claimGift = (giftId: string): Card | null => {
    const gift = giftBoxes.find((g) => g.id === giftId)
    if (!gift || gift.claimed) return null

    setGiftBoxes((prev) => prev.map((g) => (g.id === giftId ? { ...g, claimed: true } : g)))

    // Handle playmat reward
    if (gift.playmatId) {
      const playmat = ALL_PLAYMATS.find((p) => p.id === gift.playmatId)
      if (playmat && !ownedPlaymats.some((p) => p.id === playmat.id)) {
        setOwnedPlaymats((prev) => [...prev, playmat])
      }
      return null
    }

    // Handle coin reward
    if (gift.coinsReward) {
      setCoins((prev) => prev + gift.coinsReward!)
      return null
    }

    // Handle card reward
    if (gift.cardId) {
      const card = ALL_CARDS.find((c) => c.id === gift.cardId)
      if (card) {
        addToCollection([card])
        return card
      }
    }

    return null
  }

  const addGift = (gift: Omit<GiftBox, "id" | "claimed">) => {
    const newGift: GiftBox = {
      ...gift,
      id: `gift-${Date.now()}`,
      claimed: false,
    }
    setGiftBoxes((prev) => [...prev, newGift])
  }

  const hasUnclaimedGifts = giftBoxes.some((g) => !g.claimed)

  const updatePlayerProfile = (updates: Partial<PlayerProfile>) => {
    setPlayerProfile((prev) => ({ ...prev, ...updates }))
  }

  const sendFriendRequest = (targetId: string): boolean => {
    // In a real app, this would send to server
    // For demo, we simulate finding a player
    if (targetId === playerId) return false
    if (friends.some((f) => f.id === targetId)) return false
    // Simulate a successful request being sent to a server
    return true
  }

  const acceptFriendRequest = (requestId: string) => {
    const request = friendRequests.find((r) => r.id === requestId)
    if (!request) return

    // Add to friends
    const newFriend: Friend = {
      id: request.fromId,
      name: request.fromName,
      avatarUrl: request.fromAvatarUrl,
      level: 1,
      showcaseCards: [],
      affinityLevel: 1,
      affinityPoints: 0,
      isGuest: false,
      likes: 0,
    }
    setFriends((prev) => [...prev, newFriend])

    // Remove request
    setFriendRequests((prev) => prev.filter((r) => r.id !== requestId))
  }

  const rejectFriendRequest = (requestId: string) => {
    setFriendRequests((prev) => prev.filter((r) => r.id !== requestId))
  }

  const canSendHeartTo = (friendId: string): boolean => {
    const friend = friends.find((f) => f.id === friendId)
    if (!friend) return false
    // If it's a guest or they haven't sent a heart, they can receive one
    if (friend.isGuest && friend.id !== "GUEST-001") return true
    if (!friend.lastHeartSent) return true

    const lastSent = new Date(friend.lastHeartSent)
    const today = new Date()
    return lastSent.toDateString() !== today.toDateString()
  }

  const sendHeart = (friendId: string): boolean => {
    if (!canSendHeartTo(friendId)) return false

    // Update friend's affinity
    setFriends((prev) =>
      prev.map((f) => {
        if (f.id === friendId) {
          // For guests, affinity increases by 10 (base) + likes received
          const pointsToAdd = f.isGuest && f.id !== "GUEST-001" ? 10 + f.likes : 10
          const newPoints = f.affinityPoints + pointsToAdd
          const maxPoints = f.affinityLevel * 100
          const levelUp = newPoints >= maxPoints

          return {
            ...f,
            affinityPoints: levelUp ? newPoints - maxPoints : newPoints,
            affinityLevel: levelUp ? f.affinityLevel + 1 : f.affinityLevel,
            lastHeartSent: new Date().toISOString(),
          }
        }
        return f
      }),
    )

    // Add FP (both accumulated and spendable)
    setFriendPoints((prev) => prev + 5)
    setSpendableFP((prev) => prev + 5)

    // Add gift to gift box if it's not a guest
    if (!friends.find((f) => f.id === friendId)?.isGuest || friendId === "GUEST-001") {
      addGift({
        title: "Recompensa por envio de afinidade",
        message: "Você ganhou 5 Friend Points por enviar coração para seu amigo!",
        coinsReward: 5, // Assuming coinsReward is for FP here based on context
      })
    }

    return true
  }

  const sendHeartToAll = (): number => {
    let sentCount = 0
    friends.forEach((friend) => {
      if (canSendHeartTo(friend.id)) {
        if (sendHeart(friend.id)) {
          sentCount++
        }
      }
    })
    return sentCount
  }

  const likeFriendShowcase = (friendId: string) => {
    setFriends((prev) =>
      prev.map((f) => {
        if (f.id === friendId) {
          // Add affinity points based on likes, guests get more
          const pointsToAdd = f.isGuest && f.id !== "GUEST-001" ? 5 + f.likes : 5
          return { ...f, likes: f.likes + 1, affinityPoints: f.affinityPoints + pointsToAdd }
        }
        return f
      }),
    )
    setFriendPoints((prev) => prev + 2)
    setSpendableFP((prev) => prev + 2)
  }

  const spendFriendPoints = (amount: number): boolean => {
    if (spendableFP < amount) return false
    setSpendableFP((prev) => prev - amount)
    return true
  }

  const searchPlayerById = (id: string): Friend | null => {
    // In real app, this would query server
    // For demo, return a simulated player
    if (id === playerId) return null
    if (friends.some((f) => f.id === id)) return null

    // Simulate finding a random player
    if (id.startsWith("GP-") && id.length === 11) {
      return {
        id,
        name: `Jogador ${id.slice(-4)}`,
        level: Math.floor(Math.random() * 30) + 1,
        showcaseCards: [],
        affinityLevel: 1,
        affinityPoints: 0,
        isGuest: false,
        likes: 0,
      }
    }
    return null
  }

  const getGhostPlayers = (count: number): Friend[] => {
    const available = GHOST_PLAYERS.slice(0, count)
    return available
  }

  // Account Auth Functions
  const loginAccount = async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    // Simulated login - in production this would call a real API
    const storedAccounts = localStorage.getItem("gear-perks-accounts")
    const accounts = storedAccounts ? JSON.parse(storedAccounts) : {}

    if (!accounts[email]) {
      return { success: false, error: "Conta nao encontrada" }
    }

    if (accounts[email].password !== password) {
      return { success: false, error: "Senha incorreta" }
    }

    // Load saved progress
    const savedProgress = accounts[email].progress
    if (savedProgress) {
      if (savedProgress.coins) setCoins(savedProgress.coins)
      if (savedProgress.collection) setCollection(savedProgress.collection)
      if (savedProgress.decks) setDecks(savedProgress.decks)
      if (savedProgress.matchHistory) setMatchHistory(savedProgress.matchHistory)
      if (savedProgress.giftBoxes) setGiftBoxes(savedProgress.giftBoxes)
      if (savedProgress.friends) setFriends(savedProgress.friends)
      if (savedProgress.friendRequests) setFriendRequests(savedProgress.friendRequests)
      if (savedProgress.friendPoints) setFriendPoints(savedProgress.friendPoints)
      if (savedProgress.spendableFP) setSpendableFP(savedProgress.spendableFP)
      if (savedProgress.playerProfile) setPlayerProfile(savedProgress.playerProfile)
      // Player ID is generated locally, so not loaded from account progress to maintain uniqueness.
      // However, if you wanted to sync playerId across devices for the same account, you'd load it here.
    }

    const auth: AccountAuth = {
      isLoggedIn: true,
      email,
      uniqueCode: null,
      lastSaved: savedProgress?.lastSaved || null,
    }
    setAccountAuth(auth)
    localStorage.setItem("gear-perks-auth", JSON.stringify(auth))

    return { success: true }
  }

  const registerAccount = async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    if (!email.includes("@")) {
      return { success: false, error: "Email invalido" }
    }
    if (password.length < 6) {
      return { success: false, error: "Senha deve ter pelo menos 6 caracteres" }
    }

    const storedAccounts = localStorage.getItem("gear-perks-accounts")
    const accounts = storedAccounts ? JSON.parse(storedAccounts) : {}

    if (accounts[email]) {
      return { success: false, error: "Este email ja esta registrado" }
    }

    // Save current progress to new account
    const now = new Date().toISOString()
    accounts[email] = {
      password,
      progress: {
        coins,
        collection,
        decks,
        matchHistory,
        giftBoxes,
        friends,
        friendRequests,
        friendPoints,
        spendableFP,
        playerProfile,
        playerId, // Save current playerId
        lastSaved: now,
      },
    }
    localStorage.setItem("gear-perks-accounts", JSON.stringify(accounts))

    const auth: AccountAuth = {
      isLoggedIn: true,
      email,
      uniqueCode: null,
      lastSaved: now,
    }
    setAccountAuth(auth)
    localStorage.setItem("gear-perks-auth", JSON.stringify(auth))

    return { success: true }
  }

  // Generate unique code for account
  const generateUniqueCode = () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    let code = ""
    for (let i = 0; i < 12; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return code
  }

  // Simple hash function for password (for local storage fallback)
  const simpleHash = async (text: string): Promise<string> => {
    const encoder = new TextEncoder()
    const data = encoder.encode(text)
    const hashBuffer = await crypto.subtle.digest("SHA-256", data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
  }

  // Register with unique code
  const registerWithCode = async (password: string): Promise<{ success: boolean; error?: string; code?: string }> => {
    if (password.length < 6) {
      return { success: false, error: "Senha deve ter pelo menos 6 caracteres" }
    }

    let supabase
    try {
      supabase = createClient()
      console.log("[v0] Supabase client created successfully")
    } catch (clientError) {
      console.error("[v0] Failed to create Supabase client:", clientError)
      return { success: false, error: "Erro de conexao com o servidor. Verifique sua internet." }
    }
    
    const code = generateUniqueCode()
    const passwordHash = await simpleHash(password)
    
    // Generate a valid UUID for user_id
    const userUUID = crypto.randomUUID()

    // Try to save to Supabase
    try {
      console.log("[v0] Registering with code:", code, "userUUID:", userUUID)
      console.log("[v0] Supabase URL configured:", !!process.env.NEXT_PUBLIC_SUPABASE_URL)
      
      // First, save the unique code
      const { data: codeData, error: codeError } = await supabase.from("unique_codes").insert({
        user_id: userUUID,
        code,
        password_hash: passwordHash,
      }).select().single()

      console.log("[v0] unique_codes insert result:", { data: codeData, error: codeError })

      if (codeError) {
        // If unique constraint error, generate new code
        if (codeError.code === "23505") {
          return registerWithCode(password) // Retry with new code
        }
        console.error("[v0] Supabase error:", codeError)
        return { success: false, error: `Erro ao criar conta: ${codeError.message}` }
      }

      // Now save the player profile to the new player_profiles table
      const profileData = {
        user_code: code,
        player_name: playerProfile.name || "Jogador",
        player_title: playerProfile.title || "Iniciante",
        avatar_id: playerProfile.avatarUrl || null,
        coins: coins,
        gems: 0,
        collection: collection,
        decks: decks,
        duel_history: matchHistory,
        gacha_pity: 0,
        total_wins: matchHistory.filter(m => m.result === "won").length,
        total_losses: matchHistory.filter(m => m.result === "lost").length,
      }

      const { data: profileResult, error: profileError } = await supabase.from("player_profiles").insert(profileData).select().single()
      
      console.log("[v0] player_profiles insert result:", { data: profileResult, error: profileError })
      
      if (profileError) {
        console.error("[v0] Error saving player profile:", profileError)
        // Continue anyway, the code was created successfully
      }
      
      // Update local playerId with the new UUID
      setPlayerId(userUUID)
      localStorage.setItem("gear-perks-player-id", userUUID)

    } catch (err) {
      console.error("[v0] Registration exception:", err)
      return { success: false, error: `Erro ao criar conta: ${err instanceof Error ? err.message : "Tente novamente."}` }
    }

    const now = new Date().toISOString()
    const auth: AccountAuth = {
      isLoggedIn: true,
      email: null,
      uniqueCode: code,
      lastSaved: now,
    }
    setAccountAuth(auth)
    localStorage.setItem("gear-perks-auth", JSON.stringify(auth))

    return { success: true, code }
  }

  // Login with unique code
  const loginWithCode = async (code: string, password: string): Promise<{ success: boolean; error?: string }> => {
    const supabase = createClient()
    const passwordHash = await simpleHash(password)
    const normalizedCode = code.toUpperCase().replace(/[^A-Z0-9]/g, "")

    // Try Supabase first
    try {
      // Verify the code and password
      const { data: codeData, error: codeError } = await supabase
        .from("unique_codes")
        .select("*")
        .eq("code", normalizedCode)
        .single()

      if (codeError || !codeData) {
        return { success: false, error: "Codigo nao encontrado" }
      }

      if (codeData.password_hash !== passwordHash) {
        return { success: false, error: "Senha incorreta" }
      }

      // Load player profile from Supabase
      const { data: profileData, error: profileError } = await supabase
        .from("player_profiles")
        .select("*")
        .eq("user_code", normalizedCode)
        .single()

      if (profileData && !profileError) {
        // Load all data from the cloud profile
        setCoins(profileData.coins ?? 999)
        setCollection(profileData.collection ?? [])
        setDecks(profileData.decks ?? [])
        setMatchHistory(profileData.duel_history ?? [])
        setGiftBoxes(INITIAL_GIFT_BOXES)
        setFriends([DEFAULT_GUEST_FRIEND])
        setFriendRequests([])
        setFriendPoints(0)
        setSpendableFP(0)
        
        // Update player profile
        const loadedProfile: PlayerProfile = {
          id: profileData.id,
          name: profileData.player_name || "Jogador",
          title: profileData.player_title || "Iniciante",
          level: 1,
          avatarUrl: profileData.avatar_id,
          showcaseCards: [],
          hasCompletedSetup: true,
        }
        setPlayerProfile(loadedProfile)
        setPlayerId(codeData.user_id)

        // Also save to localStorage for offline access (both key formats)
        setLS("coins", profileData.coins?.toString() ?? "999")
        setLS("collection", JSON.stringify(profileData.collection ?? []))
        setLS("decks", JSON.stringify(profileData.decks ?? []))
        setLS("history", JSON.stringify(profileData.duel_history ?? []))
        setLS("profile", JSON.stringify(loadedProfile))
        setLS("playerid", codeData.user_id)
      } else {
        // Profile not found in cloud, use local data but still log in
        console.log("Profile not found in cloud, using local data")
      }

      const now = new Date().toISOString()
      const auth: AccountAuth = {
        isLoggedIn: true,
        email: null,
        uniqueCode: normalizedCode,
        lastSaved: now,
      }
      setAccountAuth(auth)
      localStorage.setItem("gear-perks-auth", JSON.stringify(auth))

      return { success: true }
    } catch (err) {
      console.error("Login error:", err)
      return { success: false, error: "Erro ao fazer login. Verifique sua conexao." }
    }
  }

  // Link email to existing code account
  const linkEmailToCode = async (email: string): Promise<{ success: boolean; error?: string }> => {
    if (!accountAuth.uniqueCode) {
      return { success: false, error: "Nenhum codigo vinculado" }
    }
    if (!email.includes("@")) {
      return { success: false, error: "Email invalido" }
    }

    // Update auth to include email
    const auth: AccountAuth = {
      ...accountAuth,
      email,
    }
    setAccountAuth(auth)
    localStorage.setItem("gear-perks-auth", JSON.stringify(auth))

    return { success: true }
  }

  const logoutAccount = () => {
    // Clear local storage related to this account's progress before logging out
    // This prevents loading old progress when logging in with a different account or as a guest.
    // However, be careful not to clear general settings if they are stored separately.
    // For simplicity here, we just clear the auth token.
    // In a more robust system, you might have a way to specifically clear or isolate account data.

    // Clear the auth token
    localStorage.removeItem("gear-perks-auth")
    // Optionally clear other account-specific data if they exist and are tied to login state
    // localStorage.removeItem("gear-perks-accounts"); // Be careful, this clears ALL accounts

    // Reset game state to defaults
    setCoins(999)
    setCollection([])
    setDecks([])
    setMatchHistory([])
    setGiftBoxes(INITIAL_GIFT_BOXES) // Reset to initial gifts
    setPlayerId(generatePlayerId()) // Generate a new guest ID
    setPlayerProfile({
      id: "",
      name: "Jogador",
      title: "Novato",
      level: 1,
      showcaseCards: [],
    })
    setFriends([DEFAULT_GUEST_FRIEND]) // Reset to default guest friend
    setFriendRequests([])
    setFriendPoints(0)
    setSpendableFP(0)

    setAccountAuth({
      isLoggedIn: false,
      email: null,
      uniqueCode: null,
      lastSaved: null,
    })

    // Reset playmat states on logout
    setOwnedPlaymats([])
    setGlobalPlaymatId(null)
  }

  const saveProgressManually = async () => {
    if (!accountAuth.isLoggedIn) return

    const now = new Date().toISOString()

    // Save to Supabase if we have a unique code
    if (accountAuth.uniqueCode) {
      const supabase = createClient()
      
      const profileUpdate = {
        player_name: playerProfile.name,
        player_title: playerProfile.title,
        avatar_id: playerProfile.avatarUrl,
        coins: coins,
        collection: collection,
        decks: decks,
        duel_history: matchHistory,
        total_wins: matchHistory.filter(m => m.result === "won").length,
        total_losses: matchHistory.filter(m => m.result === "lost").length,
        updated_at: now,
      }

      try {
        const { error } = await supabase
          .from("player_profiles")
          .update(profileUpdate)
          .eq("user_code", accountAuth.uniqueCode)

        if (error) {
          console.error("Error saving to cloud:", error)
          // If profile doesn't exist, create it
          if (error.code === "PGRST116") {
            await supabase.from("player_profiles").insert({
              user_code: accountAuth.uniqueCode,
              ...profileUpdate,
            })
          }
        }
      } catch (err) {
        console.error("Error saving progress:", err)
      }

      // Also save to localStorage for offline access (both key formats)
      setLS("coins", coins.toString())
      setLS("collection", JSON.stringify(collection))
      setLS("decks", JSON.stringify(decks))
      setLS("history", JSON.stringify(matchHistory))
      setLS("profile", JSON.stringify(playerProfile))
      
      setAccountAuth((prev) => ({ ...prev, lastSaved: now }))
      localStorage.setItem("gear-perks-auth", JSON.stringify({ ...accountAuth, lastSaved: now }))
    }
  }

  // Autosave every 30 seconds when logged in
  useEffect(() => {
    if (!accountAuth.isLoggedIn) return

    const autoSaveInterval = setInterval(() => {
      saveProgressManually()
    }, 30000) // 30 seconds

    // Cleanup interval on component unmount or when isLoggedIn changes to false
    return () => clearInterval(autoSaveInterval)
  }, [
    accountAuth.isLoggedIn,
    coins,
    collection,
    decks,
    matchHistory,
    giftBoxes,
    friends,
    friendRequests,
    friendPoints,
    spendableFP,
    playerProfile,
    playerId,
    ownedPlaymats, // Include playmat states in dependency array
    globalPlaymatId,
  ])

  const setGlobalPlaymat = (playmatId: string | null) => {
    setGlobalPlaymatId(playmatId)
  }

  const getPlaymatForDeck = (deck: Deck): Playmat | null => {
  // If deck uses global playmat or has no specific setting
  if (deck.useGlobalPlaymat !== false && globalPlaymatId) {
  return ownedPlaymats.find((p) => p.id === globalPlaymatId) || null
  }
  // If deck has specific playmat
  if (deck.playmatId) {
  return ownedPlaymats.find((p) => p.id === deck.playmatId) || null
  }
  // Fallback to global
  if (globalPlaymatId) {
  return ownedPlaymats.find((p) => p.id === globalPlaymatId) || null
  }
  return null
  }
  
  // Redeem promotional codes
  const redeemCode = (code: string): { success: boolean; message: string } => {
    const normalizedCode = code.toUpperCase().trim()
    
    // Check if code was already redeemed
    if (redeemedCodes.includes(normalizedCode)) {
      return { success: false, message: "Este codigo ja foi resgatado!" }
    }
    
    // ALLCARDS - Unlocks all cards with 4 copies each
    if (normalizedCode === "ALLCARDS") {
      // Get all cards with 4 copies each
      const allCardsWithCopies: Card[] = []
      ALL_CARDS.forEach((card) => {
        for (let i = 0; i < 4; i++) {
          allCardsWithCopies.push({ ...card })
        }
      })
      
      // Add to collection and persist immediately
      setCollection(allCardsWithCopies)
      setLS("collection", JSON.stringify(allCardsWithCopies))
      
      // Mark code as redeemed and persist immediately
      const newRedeemedCodes = [...redeemedCodes, normalizedCode]
      setRedeemedCodes(newRedeemedCodes)
      setLS("redeemed-codes", JSON.stringify(newRedeemedCodes))
      
      return { success: true, message: `Todas as ${ALL_CARDS.length} cartas foram desbloqueadas com 4 copias cada!` }
    }
    
    // Invalid code
    return { success: false, message: "Codigo invalido!" }
  }
  
  // Delete all account data but keep logged in
  const deleteAccountData = async (): Promise<{ success: boolean; error?: string }> => {
    try {
      // Reset all game data to defaults
      setCoins(999)
      setCollection([])
      setDecks([])
      setMatchHistory([])
      setGiftBoxes(INITIAL_GIFT_BOXES)
      setFriends([DEFAULT_GUEST_FRIEND])
      setFriendRequests([])
      setFriendPoints(0)
      setSpendableFP(0)
      setOwnedPlaymats([])
      setGlobalPlaymatId(null)
      setRedeemedCodes([])
      setPlayerProfile({
        id: playerId,
        name: "Jogador",
        title: "Iniciante",
        level: 1,
        showcaseCards: [],
        hasCompletedSetup: false,
      })
      
      // Clear localStorage data
      localStorage.removeItem("gearperks-coins")
      localStorage.removeItem("gearperks-collection")
      localStorage.removeItem("gearperks-decks")
      localStorage.removeItem("gearperks-history")
      localStorage.removeItem("gearperks-giftboxes")
      localStorage.removeItem("gearperks-profile")
      localStorage.removeItem("gearperks-friends")
      localStorage.removeItem("gearperks-friend-requests")
      localStorage.removeItem("gearperks-friend-points")
      localStorage.removeItem("gearperks-spendable-fp")
      localStorage.removeItem("gearperks_owned_playmats")
      localStorage.removeItem("gearperks_global_playmat")
      localStorage.removeItem("gearperks-redeemed-codes")
      
      // If logged in with Supabase, also clear cloud data
      if (accountAuth.isLoggedIn && accountAuth.uniqueCode) {
        try {
          const { createClient } = await import("@/lib/supabase/client")
          const supabase = createClient()
          
          // Update the player profile in the cloud with reset data
          await supabase
            .from("player_profiles")
            .update({
              coins: 999,
              collection: [],
              decks: [],
              duel_history: [],
              total_wins: 0,
              total_losses: 0,
              player_name: "Jogador",
              player_title: "Iniciante",
              avatar_id: null,
              gacha_pity: 0,
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", playerId)
        } catch (err) {
          console.error("Error clearing cloud data:", err)
        }
      }
      
      return { success: true }
    } catch (err) {
      console.error("Error deleting account data:", err)
      return { success: false, error: "Erro ao deletar dados da conta" }
    }
  }

  return (
    <GameContext.Provider
      value={{
        coins,
        setCoins,
        collection,
        addToCollection,
        decks,
        saveDeck,
        deleteDeck,
        matchHistory,
        addMatchRecord,
        allCards: ALL_CARDS,
        giftBoxes,
        claimGift,
        addGift,
        hasUnclaimedGifts,
        playerId,
        playerProfile,
        updatePlayerProfile,
        friends,
        friendRequests,
        friendPoints,
        spendableFP,
        sendFriendRequest,
        acceptFriendRequest,
        rejectFriendRequest,
        sendHeart,
        sendHeartToAll,
        likeFriendShowcase,
        spendFriendPoints,
        searchPlayerById,
        getGhostPlayers,
        canSendHeartTo,
        // Account Auth
        accountAuth,
        loginAccount,
        registerAccount,
        loginWithCode,
        registerWithCode,
        linkEmailToCode,
        logoutAccount,
        saveProgressManually,
  // Added playmat-related values
  allPlaymats: ALL_PLAYMATS,
  ownedPlaymats,
  globalPlaymatId,
  setGlobalPlaymat,
  getPlaymatForDeck,
  // Code redemption
  redeemCode,
  redeemedCodes,
  deleteAccountData,
  mobileMode,
  setMobileMode: (enabled: boolean) => {
    setMobileModeState(enabled)
    if (typeof window !== "undefined") {
      localStorage.setItem("gearperks-mobile-mode", enabled ? "true" : "false")
      localStorage.setItem("gear-perks-mobile-mode", enabled ? "true" : "false")
    }
  },
  }}
  >
      {children}
    </GameContext.Provider>
  )
}

export function useGame() {
  const context = useContext(GameContext)
  if (!context) {
    throw new Error("useGame must be used within GameProvider")
  }
  return context
}
