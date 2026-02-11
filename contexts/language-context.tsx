"use client"

import { createContext, useContext, useState, type ReactNode } from "react"

type Language = "pt" | "en" | "ja"

interface Translations {
  [key: string]: {
    pt: string
    en: string
    ja: string
  }
}

const translations: Translations = {
  // Menu
  play: { pt: "JOGAR", en: "PLAY", ja: "プレイ" },
  vsBot: { pt: "VS BOT", en: "VS BOT", ja: "VS BOT" },
  vsPlayer: { pt: "VS JOGADOR", en: "VS PLAYER", ja: "VS プレイヤー" },
  createRoom: { pt: "CRIAR SALA", en: "CREATE ROOM", ja: "ルーム作成" },
  joinRoom: { pt: "ENTRAR NA SALA", en: "JOIN ROOM", ja: "ルーム参加" },
  gacha: { pt: "GACHA", en: "GACHA", ja: "ガチャ" },
  collection: { pt: "COLEÇÃO", en: "COLLECTION", ja: "コレクション" },
  deckBuilder: { pt: "CONSTRUIR DECK", en: "BUILD DECK", ja: "デッキ構築" },
  history: { pt: "HISTÓRICO", en: "HISTORY", ja: "履歴" },
  settings: { pt: "CONFIGURAÇÕES", en: "SETTINGS", ja: "設定" },
  back: { pt: "VOLTAR", en: "BACK", ja: "戻る" },

  // Gacha
  gacha1: { pt: "GACHA x1", en: "GACHA x1", ja: "ガチャ x1" },
  gacha10: { pt: "GACHA x10", en: "GACHA x10", ja: "ガチャ x10" },
  coins: { pt: "Moedas", en: "Coins", ja: "コイン" },
  packOpening: { pt: "Abrindo Pack...", en: "Opening Pack...", ja: "パック開封中..." },

  // Collection
  filterByName: { pt: "Filtrar por nome", en: "Filter by name", ja: "名前でフィルター" },
  ascending: { pt: "Crescente", en: "Ascending", ja: "昇順" },
  descending: { pt: "Decrescente", en: "Descending", ja: "降順" },
  allRarities: { pt: "Todas Raridades", en: "All Rarities", ja: "全レアリティ" },
  allTypes: { pt: "Todos Tipos", en: "All Types", ja: "全タイプ" },
  unit: { pt: "Unidade", en: "Unit", ja: "ユニット" },
  magic: { pt: "Magia", en: "Magic", ja: "魔法" },
  action: { pt: "Action", en: "Action", ja: "アクション" },
  ultimateGear: { pt: "Ultimate Gear", en: "Ultimate Gear", ja: "アルティメットギア" },
  ultimateGuardian: { pt: "Ultimate Guardian", en: "Ultimate Guardian", ja: "アルティメットガーディアン" },
  item: { pt: "Item", en: "Item", ja: "アイテム" },

  // Deck Builder
  newDeck: { pt: "Novo Deck", en: "New Deck", ja: "新しいデッキ" },
  saveDeck: { pt: "Salvar Deck", en: "Save Deck", ja: "デッキ保存" },
  deleteDeck: { pt: "Deletar Deck", en: "Delete Deck", ja: "デッキ削除" },
  deckName: { pt: "Nome do Deck", en: "Deck Name", ja: "デッキ名" },
  cards: { pt: "cartas", en: "cards", ja: "枚" },
  minCards: { pt: "Mínimo 10 cartas", en: "Minimum 10 cards", ja: "最低10枚" },
  maxCards: { pt: "Máximo 20 cartas", en: "Maximum 20 cards", ja: "最大20枚" },
  maxCopies: { pt: "Máximo 4 cópias por carta", en: "Maximum 4 copies per card", ja: "カード毎に最大4枚" },

  // Duel
  yourTurn: { pt: "SEU TURNO", en: "YOUR TURN", ja: "あなたのターン" },
  enemyTurn: { pt: "TURNO INIMIGO", en: "ENEMY TURN", ja: "敵のターン" },
  drawPhase: { pt: "Fase de Compra", en: "Draw Phase", ja: "ドローフェイズ" },
  mainPhase: { pt: "Fase Principal", en: "Main Phase", ja: "メインフェイズ" },
  battlePhase: { pt: "Fase de Batalha", en: "Battle Phase", ja: "バトルフェイズ" },
  endPhase: { pt: "Fase Final", en: "End Phase", ja: "エンドフェイズ" },
  endTurn: { pt: "Finalizar Turno", en: "End Turn", ja: "ターン終了" },
  surrender: { pt: "Desistir", en: "Surrender", ja: "降参" },
  victory: { pt: "VITÓRIA!", en: "VICTORY!", ja: "勝利！" },
  defeat: { pt: "DERROTA!", en: "DEFEAT!", ja: "敗北！" },
  life: { pt: "VIDA", en: "LIFE", ja: "ライフ" },
  turn: { pt: "Turno", en: "Turn", ja: "ターン" },
  hand: { pt: "Mão", en: "Hand", ja: "手札" },
  deck: { pt: "Deck", en: "Deck", ja: "デッキ" },
  graveyard: { pt: "Cemitério", en: "Graveyard", ja: "墓地" },
  unitZone: { pt: "Zona de Unidades", en: "Unit Zone", ja: "ユニットゾーン" },
  functionZone: { pt: "Zona de Funções", en: "Function Zone", ja: "ファンクションゾーン" },
  phase: { pt: "Fase", en: "Phase", ja: "フェイズ" },
  drawCard: { pt: "Comprar Carta", en: "Draw Card", ja: "カードを引く" },
  toBattle: { pt: "Ir para Batalha", en: "Go to Battle", ja: "バトルへ" },
  dragToAttack: { pt: "Arraste!", en: "Drag!", ja: "ドラッグ!" },
  canAttackTurn: { pt: "Ataca no turno", en: "Attacks on turn", ja: "ターンに攻撃" },

  // History
  matchHistory: { pt: "Histórico de Partidas", en: "Match History", ja: "対戦履歴" },
  won: { pt: "Vitória", en: "Won", ja: "勝利" },
  lost: { pt: "Derrota", en: "Lost", ja: "敗北" },
  vsBot2: { pt: "vs Bot", en: "vs Bot", ja: "vs Bot" },
  vsPlayer2: { pt: "vs Jogador", en: "vs Player", ja: "vs プレイヤー" },

  // Settings
  language: { pt: "Idioma", en: "Language", ja: "言語" },
  portuguese: { pt: "Português", en: "Portuguese", ja: "ポルトガル語" },
  english: { pt: "Inglês", en: "English", ja: "英語" },
  japanese: { pt: "Japonês", en: "Japanese", ja: "日本語" },

  // Room / Multiplayer
  roomCode: { pt: "Código da Sala", en: "Room Code", ja: "ルームコード" },
  enterCode: { pt: "Digite o código", en: "Enter code", ja: "コードを入力" },
  waiting: { pt: "Aguardando oponente...", en: "Waiting for opponent...", ja: "対戦相手を待っています..." },
  join: { pt: "Entrar", en: "Join", ja: "参加" },
  create: { pt: "Criar", en: "Create", ja: "作成" },
  
  // Multiplayer Lobby
  multiplayerMode: { pt: "MODO MULTIPLAYER", en: "MULTIPLAYER MODE", ja: "マルチプレイヤーモード" },
  createPrivateRoom: { pt: "CRIAR SALA PRIVADA", en: "CREATE PRIVATE ROOM", ja: "プライベートルーム作成" },
  joinWithCode: { pt: "ENTRAR COM CÓDIGO", en: "JOIN WITH CODE", ja: "コードで参加" },
  selectDeck: { pt: "Selecione seu Deck", en: "Select your Deck", ja: "デッキを選択" },
  creatingRoom: { pt: "Criando sala...", en: "Creating room...", ja: "ルーム作成中..." },
  joiningRoom: { pt: "Entrando na sala...", en: "Joining room...", ja: "ルーム参加中..." },
  roomCreated: { pt: "Sala Criada!", en: "Room Created!", ja: "ルーム作成完了！" },
  shareCode: { pt: "Compartilhe este código com seu amigo:", en: "Share this code with your friend:", ja: "このコードを友達と共有してください：" },
  waitingForOpponent: { pt: "Aguardando oponente entrar...", en: "Waiting for opponent to join...", ja: "対戦相手の参加を待っています..." },
  copied: { pt: "Copiado!", en: "Copied!", ja: "コピーしました！" },
  copyCode: { pt: "Copiar Código", en: "Copy Code", ja: "コードをコピー" },
  invalidCode: { pt: "Código inválido ou sala não encontrada", en: "Invalid code or room not found", ja: "無効なコードまたはルームが見つかりません" },
  roomFull: { pt: "Sala já está cheia", en: "Room is already full", ja: "ルームは満員です" },
  player1: { pt: "Jogador 1", en: "Player 1", ja: "プレイヤー1" },
  player2: { pt: "Jogador 2", en: "Player 2", ja: "プレイヤー2" },
  host: { pt: "(Anfitrião)", en: "(Host)", ja: "(ホスト)" },
  guest: { pt: "(Convidado)", en: "(Guest)", ja: "(ゲスト)" },
  waitingPlayer: { pt: "Esperando...", en: "Waiting...", ja: "待機中..." },
  readyButton: { pt: "PRONTO!", en: "READY!", ja: "準備完了！" },
  notReadyButton: { pt: "ESPERANDO", en: "WAITING", ja: "待機中" },
  bothPlayersReady: { pt: "Ambos jogadores prontos! Iniciando duelo...", en: "Both players ready! Starting duel...", ja: "両プレイヤー準備完了！デュエル開始..." },
  chat: { pt: "Chat", en: "Chat", ja: "チャット" },
  typeMessage: { pt: "Digite uma mensagem...", en: "Type a message...", ja: "メッセージを入力..." },
  send: { pt: "Enviar", en: "Send", ja: "送信" },
  lobby: { pt: "Lobby", en: "Lobby", ja: "ロビー" },
  leaveRoom: { pt: "Sair da Sala", en: "Leave Room", ja: "ルームを退出" },
  opponentLeft: { pt: "Oponente saiu da sala", en: "Opponent left the room", ja: "対戦相手が退出しました" },
  connectionError: { pt: "Erro de conexão", en: "Connection error", ja: "接続エラー" },
  onlineDuel: { pt: "DUELO ONLINE", en: "ONLINE DUEL", ja: "オンラインデュエル" },
  opponentTurn: { pt: "TURNO DO OPONENTE", en: "OPPONENT'S TURN", ja: "相手のターン" },
  waitingOpponentAction: { pt: "Aguardando ação do oponente...", en: "Waiting for opponent's action...", ja: "相手のアクションを待っています..." },
  youWon: { pt: "VOCÊ VENCEU!", en: "YOU WON!", ja: "あなたの勝ち！" },
  youLost: { pt: "VOCÊ PERDEU!", en: "YOU LOST!", ja: "あなたの負け！" },
  opponentSurrendered: { pt: "Oponente desistiu!", en: "Opponent surrendered!", ja: "相手が降参しました！" },
  opponentDisconnected: { pt: "Oponente desconectou", en: "Opponent disconnected", ja: "相手が切断しました" },
  returnToMenu: { pt: "Voltar ao Menu", en: "Return to Menu", ja: "メニューに戻る" },
  noDeckSelected: { pt: "Nenhum deck selecionado", en: "No deck selected", ja: "デッキが選択されていません" },
  selectDeckFirst: { pt: "Selecione um deck primeiro", en: "Select a deck first", ja: "まずデッキを選択してください" },
}

interface LanguageContextType {
  language: Language
  setLanguage: (lang: Language) => void
  t: (key: string) => string
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>("pt")

  const t = (key: string): string => {
    return translations[key]?.[language] || key
  }

  return <LanguageContext.Provider value={{ language, setLanguage, t }}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) {
    throw new Error("useLanguage must be used within LanguageProvider")
  }
  return context
}
