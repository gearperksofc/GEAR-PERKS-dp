"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"

interface TitleScreenProps {
  onEnter: () => void
}

export default function TitleScreen({ onEnter }: TitleScreenProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [visible, setVisible] = useState(false)
  const [blink, setBlink] = useState(true)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 100)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const interval = setInterval(() => setBlink((b) => !b), 800)
    return () => clearInterval(interval)
  }, [])

  const startMusic = () => {
    if (audioRef.current) {
      audioRef.current.volume = 0.5
      audioRef.current.loop = true
      audioRef.current.play().catch(() => {})
    }
  }

  const handleEnter = () => {
    if (leaving) return
    setLeaving(true)
    if (audioRef.current) {
      const audio = audioRef.current
      const fadeOut = setInterval(() => {
        if (audio.volume > 0.05) {
          audio.volume = Math.max(0, audio.volume - 0.05)
        } else {
          audio.pause()
          clearInterval(fadeOut)
        }
      }, 60)
    }
    setTimeout(() => onEnter(), 700)
  }

  return (
    <div
      onClick={() => { startMusic(); handleEnter() }}
      className="fixed inset-0 cursor-pointer select-none overflow-hidden"
      style={{
        opacity: leaving ? 0 : visible ? 1 : 0,
        transition: leaving ? "opacity 0.7s ease-in" : "opacity 1s ease-out",
        zIndex: 9999,
      }}
    >
      <audio ref={audioRef} src="/audio/Menu_Game_OST.mp3" preload="auto" />

      <div className="absolute inset-0">
        <Image
          src="/images/the_great_order_wallpaper.png"
          alt="Background"
          fill
          className="object-cover object-center"
          priority
          quality={95}
        />
        <div
          className="absolute inset-0"
          style={{ background: "radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.55) 100%)" }}
        />
        <div
          className="absolute bottom-0 left-0 right-0 h-56"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%)" }}
        />
      </div>

      {Array.from({ length: 18 }).map((_, i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            width: `${2 + (i % 4)}px`,
            height: `${2 + (i % 4)}px`,
            left: `${(i * 5.5) % 100}%`,
            top: `${(i * 7.3) % 100}%`,
            background: i % 3 === 0 ? "#60a5fa" : i % 3 === 1 ? "#a78bfa" : "#f9a8d4",
            opacity: 0.5 + (i % 3) * 0.15,
            animation: `floatParticle ${4 + (i % 5)}s ease-in-out ${(i * 0.4) % 3}s infinite alternate`,
          }}
        />
      ))}

      <div
        className="absolute inset-0 flex flex-col items-center justify-center"
        style={{ paddingBottom: "80px" }}
      >
        <div
          style={{
            animation: "logoFloat 3.5s ease-in-out infinite",
            filter: "drop-shadow(0 0 32px rgba(59,130,246,0.7)) drop-shadow(0 0 80px rgba(99,102,241,0.4))",
          }}
        >
          <Image
            src="/images/GP_CG_logo.png"
            alt="Gear Perks Card Game"
            width={420}
            height={420}
            className="object-contain"
            priority
            style={{ maxWidth: "min(420px, 80vw)" }}
          />
        </div>

        <div className="mt-6 mb-8 flex items-center gap-3" style={{ width: "min(320px, 70vw)" }}>
          <div className="flex-1 h-px" style={{ background: "linear-gradient(to right, transparent, #60a5fa, transparent)" }} />
          <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
          <div className="flex-1 h-px" style={{ background: "linear-gradient(to right, transparent, #60a5fa, transparent)" }} />
        </div>

        <p
          style={{
            fontFamily: "'Segoe UI', sans-serif",
            fontSize: "clamp(13px, 2.5vw, 17px)",
            letterSpacing: "0.25em",
            color: "#e0f2fe",
            textTransform: "uppercase",
            textShadow: "0 0 20px rgba(96,165,250,0.8), 0 2px 8px rgba(0,0,0,0.8)",
            opacity: blink ? 1 : 0.2,
            transition: "opacity 0.4s ease",
          }}
        >
          Toque para Começar
        </p>
      </div>

      <div className="absolute bottom-4 left-0 right-0 text-center">
        <p style={{ fontFamily: "'Segoe UI', sans-serif", fontSize: "11px", letterSpacing: "0.1em", color: "rgba(255,255,255,0.35)" }}>
          Gear Perks Card Game
        </p>
      </div>

      <style>{`
        @keyframes logoFloat {
          0%   { transform: translateY(0px) rotate(-0.5deg); }
          50%  { transform: translateY(-18px) rotate(0.5deg); }
          100% { transform: translateY(0px) rotate(-0.5deg); }
        }
        @keyframes floatParticle {
          0%   { transform: translateY(0px) scale(1); opacity: 0.4; }
          100% { transform: translateY(-30px) scale(1.4); opacity: 0.8; }
        }
      `}</style>
    </div>
  )
}
