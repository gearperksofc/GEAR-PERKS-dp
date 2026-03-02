"use client"

import { useEffect, useState } from "react"
import { GameWrapper } from "@/components/game/game-wrapper"
import { GameProvider } from "@/contexts/game-context"
import { LanguageProvider } from "@/contexts/language-context"

export type { GameScreen } from "@/components/game/game-wrapper"

export default function Home() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <LanguageProvider>
      <GameProvider>
        <div suppressHydrationWarning className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
          {mounted ? (
            <GameWrapper />
          ) : (
            <div suppressHydrationWarning className="min-h-screen flex items-center justify-center">
              <div suppressHydrationWarning className="w-16 h-16 border-4 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />
            </div>
          )}
        </div>
      </GameProvider>
    </LanguageProvider>
  )
}
