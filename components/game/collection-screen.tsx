"use client"

import { useState } from "react"
import { useLanguage } from "@/contexts/language-context"
import { useGame, type Card } from "@/contexts/game-context"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowLeft, Search, X, Sparkles } from "lucide-react"
import Image from "next/image"

interface CollectionScreenProps {
  onBack: () => void
}

export default function CollectionScreen({ onBack }: CollectionScreenProps) {
  const { t } = useLanguage()
  const { collection } = useGame()
  const [searchTerm, setSearchTerm] = useState("")
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc")
  const [filterRarity, setFilterRarity] = useState<string>("all")
  const [filterType, setFilterType] = useState<string>("all")
  const [selectedCard, setSelectedCard] = useState<Card | null>(null)

  // Get unique cards with counts
  const cardCounts = collection.reduce(
    (acc, card) => {
      const baseId = card.id.split("-").slice(0, -2).join("-") || card.id
      if (!acc[baseId]) {
        acc[baseId] = { card, count: 0 }
      }
      acc[baseId].count++
      return acc
    },
    {} as Record<string, { card: Card; count: number }>,
  )

  const uniqueCards = Object.values(cardCounts)

  // Apply filters and sorting
  let filteredCards = uniqueCards.filter(({ card }) => {
    const matchesSearch = card.name.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesRarity = filterRarity === "all" || card.rarity === filterRarity
    const matchesType = filterType === "all" || card.type === filterType
    return matchesSearch && matchesRarity && matchesType
  })

  // Sort
  filteredCards = filteredCards.sort((a, b) => {
    const comparison = a.card.name.localeCompare(b.card.name)
    return sortOrder === "asc" ? comparison : -comparison
  })

  return (
    <div className="min-h-screen flex flex-col relative">
      {/* Background */}
      <div className="fixed inset-0 bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950">
        <div className="absolute inset-0 bg-gradient-to-t from-cyan-900/10 via-transparent to-purple-900/10" />
      </div>

      {/* Header */}
      <div className="relative z-10 glass-dark border-b border-white/10">
        <div className="flex items-center justify-between p-4">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
            <span className="font-medium">{t("back")}</span>
          </button>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-cyan-400" />
            <h1 className="text-xl font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
              {t("collection")}
            </h1>
          </div>
          <div className="w-20 text-right text-slate-400 text-sm">{filteredCards.length} cartas</div>
        </div>

        {/* Filters */}
        <div className="p-4 pt-0 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder={t("filterByName")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-slate-900/50 border-slate-700 text-white rounded-xl"
            />
          </div>

          <Select value={filterRarity} onValueChange={setFilterRarity}>
            <SelectTrigger className="w-32 bg-slate-900/50 border-slate-700 text-white rounded-xl">
              <SelectValue placeholder="Raridade" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allRarities")}</SelectItem>
              <SelectItem value="R">R</SelectItem>
              <SelectItem value="SR">SR</SelectItem>
              <SelectItem value="UR">UR</SelectItem>
              <SelectItem value="LR">LR</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-36 bg-slate-900/50 border-slate-700 text-white rounded-xl">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allTypes")}</SelectItem>
              <SelectItem value="unit">{t("unit")}</SelectItem>
              <SelectItem value="magic">{t("magic")}</SelectItem>
              <SelectItem value="item">{t("item")}</SelectItem>
              <SelectItem value="ultimateGear">{t("ultimateGear")}</SelectItem>
              <SelectItem value="scenario">Scenario</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Card grid */}
      <div className="flex-1 p-4 overflow-y-auto relative z-10">
        {filteredCards.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <div className="w-20 h-20 rounded-full bg-slate-800/50 flex items-center justify-center mb-4">
              <BookOpen className="w-10 h-10 text-slate-600" />
            </div>
            <p className="text-center">
              {collection.length === 0
                ? "Nenhuma carta na colecao. Abra alguns packs no Gacha!"
                : "Nenhuma carta encontrada com esses filtros."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
            {filteredCards.map(({ card, count }) => (
              <div
                key={card.id}
                onClick={() => setSelectedCard(card)}
                className={`card-container relative rounded-xl overflow-hidden cursor-pointer transform hover:scale-105 transition-all duration-300 ${
                  card.type === "scenario" ? "aspect-[4/3]" : "aspect-[3/4]"
                } ${
                  card.rarity === "LR"
                    ? "rarity-lr"
                    : card.rarity === "UR"
                      ? "rarity-ur"
                      : card.rarity === "SR"
                        ? "rarity-sr"
                        : "rarity-r"
                }`}
              >
                <div className="card-inner w-full h-full">
                  <Image src={card.image || "/placeholder.svg"} alt={card.name} fill className="object-cover" />

                  {/* Rarity badge */}
                  <div
                    className={`absolute top-1 left-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      card.rarity === "LR"
                        ? "bg-gradient-to-r from-red-500 to-amber-500 text-white"
                        : card.rarity === "UR"
                          ? "bg-gradient-to-r from-amber-500 to-yellow-400 text-black"
                          : card.rarity === "SR"
                            ? "bg-purple-500 text-white"
                            : "bg-slate-600 text-white"
                    }`}
                  >
                    {card.rarity}
                  </div>

                  {count > 1 && (
                    <div className="absolute bottom-1 right-1 bg-black/80 text-white text-xs px-2 py-0.5 rounded-full font-bold">
                      x{count}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Card zoom modal */}
      {selectedCard && (
        <div
          className="fixed inset-0 bg-black/95 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedCard(null)}
        >
          <div className="relative w-full max-w-sm aspect-[3/4] animate-float">
            <div className="absolute inset-0 blur-3xl bg-gradient-to-r from-cyan-500 to-purple-500 opacity-30" />
            <Image
              src={selectedCard.image || "/placeholder.svg"}
              alt={selectedCard.name}
              fill
              className={`object-contain rounded-2xl ${
                selectedCard.rarity === "LR"
                  ? "rarity-lr"
                  : selectedCard.rarity === "UR"
                    ? "rarity-ur"
                    : selectedCard.rarity === "SR"
                      ? "rarity-sr"
                      : "rarity-r"
              }`}
            />
          </div>

          {/* Card info */}
          <div className="absolute bottom-8 left-0 right-0 text-center">
            <h3 className="text-2xl font-bold text-white mb-2">{selectedCard.name}</h3>
            <span
              className={`px-4 py-1 rounded-full text-sm font-bold ${
                selectedCard.rarity === "LR"
                  ? "bg-gradient-to-r from-red-500 to-amber-500 text-white"
                  : selectedCard.rarity === "UR"
                    ? "bg-gradient-to-r from-amber-500 to-yellow-400 text-black"
                    : selectedCard.rarity === "SR"
                      ? "bg-purple-500 text-white"
                      : "bg-slate-500 text-white"
              }`}
            >
              {selectedCard.rarity}
            </span>
          </div>

          <button
            onClick={() => setSelectedCard(null)}
            className="absolute top-4 right-4 p-2 glass rounded-full hover:bg-white/20 transition-colors"
          >
            <X className="w-6 h-6 text-white" />
          </button>
        </div>
      )}
    </div>
  )
}

// Missing import
import { BookOpen } from "lucide-react"
