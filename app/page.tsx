"use client"

import { GameWrapper } from "@/components/game/game-wrapper"
import { GameProvider } from "@/contexts/game-context"
import { LanguageProvider } from "@/contexts/language-context"

// Re-export GameScreen type from GameWrapper for backwards compatibility
export type { GameScreen } from "@/components/game/game-wrapper"

export default function Home() {
  return (
    <LanguageProvider>
      <GameProvider>
        <div suppressHydrationWarning className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
          <GameWrapper />
        </div>
      </GameProvider>
    </LanguageProvider>
  )
}
