"use client"

import { useState } from "react"
import { useLanguage } from "@/contexts/language-context"
import { useGame, PROFILE_ICONS } from "@/contexts/game-context"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  ArrowLeft,
  Globe,
  User,
  Copy,
  Check,
  Edit2,
  Save,
  Mail,
  Lock,
  LogIn,
  LogOut,
  Cloud,
  CloudOff,
  Settings,
  Sparkles,
  Key,
  Hash,
  Gift,
  Trash2,
  AlertTriangle,
  Monitor,
  Smartphone,
} from "lucide-react"

interface SettingsScreenProps {
  onBack: (message?: string) => void
}

type TabType = "language" | "account" | "codes" | "display"

export default function SettingsScreen({ onBack }: SettingsScreenProps) {
  const { t, language, setLanguage } = useLanguage()
  const {
    playerId,
    playerProfile,
    updatePlayerProfile,
    accountAuth,
    loginAccount,
    registerAccount,
    loginWithCode,
    registerWithCode,
    logoutAccount,
    saveProgressManually,
    redeemCode,
    redeemedCodes,
    deleteAccountData,
    mobileMode,
    setMobileMode,
  } = useGame()
  const [activeTab, setActiveTab] = useState<TabType>("language")
  const [copied, setCopied] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(playerProfile.name)
  const [editTitle, setEditTitle] = useState(playerProfile.title)
  const [editAvatarUrl, setEditAvatarUrl] = useState(playerProfile.avatarUrl || "")
  const [showIconPicker, setShowIconPicker] = useState(false)

  const [authMode, setAuthMode] = useState<"login" | "register">("login")
  const [authType, setAuthType] = useState<"email" | "code">("email")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [uniqueCode, setUniqueCode] = useState("")
  const [generatedCode, setGeneratedCode] = useState<string | null>(null)
  const [codeCopied, setCodeCopied] = useState(false)
  const [authError, setAuthError] = useState("")
  const [authLoading, setAuthLoading] = useState(false)
  const [saveMessage, setSaveMessage] = useState("")
  
  // Codes state
  const [codeInput, setCodeInput] = useState("")
  const [codeMessage, setCodeMessage] = useState<{ text: string; type: "success" | "error" } | null>(null)
  const [codeLoading, setCodeLoading] = useState(false)
  
  // Delete account state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // Mobile mode state
  const [showMobileConfirm, setShowMobileConfirm] = useState(false)
  const [detectedDevice, setDetectedDevice] = useState<"mobile" | "pc" | null>(null)

  const detectDevice = () => {
    if (typeof window === "undefined") return "pc"
    const ua = navigator.userAgent || ""
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) ||
      (window.innerWidth <= 768)
    return isMobile ? "mobile" : "pc"
  }

  const handleMobileModeToggle = () => {
    if (mobileMode) {
      // Disable mobile mode directly
      setMobileMode(false)
      onBack("Modo de Jogo Mobile desativado")
      return
    }
    // Trying to enable: detect device first
    const device = detectDevice()
    setDetectedDevice(device)
    if (device === "mobile") {
      setShowMobileConfirm(true)
    } else {
      // PC detected - still show a message but allow enabling
      setShowMobileConfirm(true)
    }
  }

  const confirmMobileMode = () => {
    setMobileMode(true)
    setShowMobileConfirm(false)
    onBack("Modo de Jogo Mobile ativado")
  }

  const handleCopyId = () => {
    navigator.clipboard.writeText(playerId)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleSaveProfile = () => {
    updatePlayerProfile({ 
      name: editName, 
      title: editTitle,
      avatarUrl: editAvatarUrl || undefined
    })
    setIsEditing(false)
    setShowIconPicker(false)
  }

  const handleLogin = async () => {
    setAuthError("")
    setAuthLoading(true)
    const result = await loginAccount(email, password)
    setAuthLoading(false)
    if (!result.success) {
      setAuthError(result.error || "Erro ao fazer login")
    } else {
      setEmail("")
      setPassword("")
    }
  }

  const handleRegister = async () => {
    setAuthError("")
    if (password !== confirmPassword) {
      setAuthError("As senhas nao coincidem")
      return
    }
    setAuthLoading(true)
    const result = await registerAccount(email, password)
    setAuthLoading(false)
    if (!result.success) {
      setAuthError(result.error || "Erro ao registrar")
    } else {
      setEmail("")
      setPassword("")
      setConfirmPassword("")
    }
  }

  const handleLoginWithCode = async () => {
    setAuthError("")
    if (!uniqueCode.trim()) {
      setAuthError("Digite o codigo unico")
      return
    }
    setAuthLoading(true)
    const result = await loginWithCode(uniqueCode, password)
    setAuthLoading(false)
    if (!result.success) {
      setAuthError(result.error || "Erro ao fazer login")
    } else {
      setUniqueCode("")
      setPassword("")
    }
  }

  const handleRegisterWithCode = async () => {
    setAuthError("")
    if (password !== confirmPassword) {
      setAuthError("As senhas nao coincidem")
      return
    }
    if (password.length < 6) {
      setAuthError("Senha deve ter pelo menos 6 caracteres")
      return
    }
    setAuthLoading(true)
    const result = await registerWithCode(password)
    setAuthLoading(false)
    if (!result.success) {
      setAuthError(result.error || "Erro ao criar conta")
    } else {
      setGeneratedCode(result.code || null)
      setPassword("")
      setConfirmPassword("")
    }
  }

  const handleCopyCode = () => {
    if (generatedCode) {
      navigator.clipboard.writeText(generatedCode)
      setCodeCopied(true)
      setTimeout(() => setCodeCopied(false), 2000)
    }
  }

  const formatCode = (code: string) => {
    // Format: XXXX-XXXX-XXXX
    const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "")
    const parts = []
    for (let i = 0; i < clean.length && i < 12; i += 4) {
      parts.push(clean.slice(i, i + 4))
    }
    return parts.join("-")
  }

  const handleManualSave = () => {
    saveProgressManually()
    setSaveMessage("Progresso salvo!")
    setTimeout(() => setSaveMessage(""), 3000)
  }
  
  const handleRedeemCode = () => {
    if (!codeInput.trim()) {
      setCodeMessage({ text: "Digite um codigo", type: "error" })
      return
    }
    setCodeLoading(true)
    const result = redeemCode(codeInput)
    setCodeLoading(false)
    setCodeMessage({ text: result.message, type: result.success ? "success" : "error" })
    if (result.success) {
      setCodeInput("")
    }
    setTimeout(() => setCodeMessage(null), 5000)
  }
  
  const handleDeleteAccount = async () => {
    setDeleteLoading(true)
    const result = await deleteAccountData()
    setDeleteLoading(false)
    if (result.success) {
      setShowDeleteConfirm(false)
      setSaveMessage("Dados da conta deletados com sucesso!")
      setTimeout(() => setSaveMessage(""), 3000)
    }
  }

  const formatLastSaved = (dateString: string | null) => {
    if (!dateString) return "Nunca"
    const date = new Date(dateString)
    return date.toLocaleString("pt-BR")
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-slate-900 via-cyan-900/10 to-black">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-cyan-400/20 rounded-full animate-float"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 5}s`,
              animationDuration: `${3 + Math.random() * 4}s`,
            }}
          />
        ))}
      </div>

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between p-4 bg-gradient-to-r from-black/80 via-cyan-900/30 to-black/80 border-b border-cyan-500/30 backdrop-blur-sm">
        <Button onClick={() => onBack()} variant="ghost" className="text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10">
          <ArrowLeft className="mr-2 h-5 w-5" />
          {t("back")}
        </Button>
        <h1 className="text-2xl font-bold bg-gradient-to-r from-cyan-400 via-blue-300 to-cyan-400 bg-clip-text text-transparent flex items-center gap-2">
          <Settings className="w-6 h-6 text-cyan-400" />
          {t("settings")}
        </h1>
        <div className="w-20" />
      </div>

      {/* Tabs */}
      <div className="relative z-10 flex border-b border-slate-700/50">
        <button
          onClick={() => setActiveTab("language")}
          className={`flex-1 py-4 px-4 font-medium transition-all ${
            activeTab === "language"
              ? "text-cyan-400 border-b-2 border-cyan-400 bg-cyan-400/10"
              : "text-slate-400 hover:text-white hover:bg-white/5"
          }`}
        >
          <Globe className="w-4 h-4 inline mr-2" />
          {t("language")}
        </button>
        <button
          onClick={() => setActiveTab("account")}
          className={`flex-1 py-4 px-4 font-medium transition-all ${
            activeTab === "account"
              ? "text-amber-400 border-b-2 border-amber-400 bg-amber-400/10"
              : "text-slate-400 hover:text-white hover:bg-white/5"
          }`}
        >
          <User className="w-4 h-4 inline mr-2" />
          Conta
        </button>
        <button
          onClick={() => setActiveTab("codes")}
          className={`flex-1 py-4 px-4 font-medium transition-all ${
            activeTab === "codes"
              ? "text-emerald-400 border-b-2 border-emerald-400 bg-emerald-400/10"
              : "text-slate-400 hover:text-white hover:bg-white/5"
          }`}
        >
          <Gift className="w-4 h-4 inline mr-2" />
          Codigos
        </button>
        <button
          onClick={() => setActiveTab("display")}
          className={`flex-1 py-4 px-4 font-medium transition-all ${
            activeTab === "display"
              ? "text-sky-400 border-b-2 border-sky-400 bg-sky-400/10"
              : "text-slate-400 hover:text-white hover:bg-white/5"
          }`}
        >
          <Monitor className="w-4 h-4 inline mr-2" />
          Display
        </button>
      </div>

      {/* Settings content */}
      <div className="relative z-10 flex-1 p-4 overflow-y-auto">
        <div className="max-w-md mx-auto space-y-4">
          {activeTab === "language" && (
            <div className="bg-gradient-to-r from-slate-800/80 to-cyan-900/30 rounded-2xl p-6 border border-cyan-500/30 backdrop-blur-sm">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg">
                  <Globe className="w-5 h-5 text-white" />
                </div>
                <h2 className="text-xl font-bold text-white">{t("language")}</h2>
              </div>

              <div className="grid gap-3">
                {[
                  { code: "pt", flag: "🇧🇷", label: t("portuguese") },
                  { code: "en", flag: "🇺🇸", label: t("english") },
                  { code: "ja", flag: "🇯🇵", label: t("japanese") },
                ].map((lang) => (
                  <Button
                    key={lang.code}
                    onClick={() => setLanguage(lang.code as "pt" | "en" | "ja")}
                    className={`w-full justify-start py-4 text-lg ${
                      language === lang.code
                        ? "bg-gradient-to-r from-cyan-600 to-blue-600 border-2 border-cyan-400/50 shadow-lg shadow-cyan-500/30"
                        : "bg-slate-800/80 hover:bg-slate-700/80 border border-slate-600/50"
                    }`}
                  >
                    <span className="text-2xl mr-3">{lang.flag}</span>
                    {lang.label}
                    {language === lang.code && <Check className="w-5 h-5 ml-auto" />}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {activeTab === "account" && (
            <>
              {/* Cloud Save Section */}
              <div className="bg-gradient-to-r from-emerald-900/40 to-teal-900/40 rounded-2xl p-6 border border-emerald-500/40 backdrop-blur-sm">
                <div className="flex items-center gap-3 mb-5">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-lg ${
                      accountAuth.isLoggedIn
                        ? "bg-gradient-to-br from-emerald-500 to-teal-600"
                        : "bg-gradient-to-br from-slate-600 to-slate-700"
                    }`}
                  >
                    {accountAuth.isLoggedIn ? (
                      <Cloud className="w-5 h-5 text-white" />
                    ) : (
                      <CloudOff className="w-5 h-5 text-white" />
                    )}
                  </div>
                  <h2 className="text-xl font-bold text-white">
                    {accountAuth.isLoggedIn ? "Conta Conectada" : "Conectar Conta"}
                  </h2>
                </div>

                {accountAuth.isLoggedIn ? (
                  <div className="space-y-4">
                    {accountAuth.email && (
                      <div className="bg-black/30 rounded-xl p-4 border border-emerald-500/20">
                        <div className="flex items-center gap-2 mb-2">
                          <Mail className="w-4 h-4 text-emerald-400" />
                          <span className="text-slate-400 text-sm">Email:</span>
                        </div>
                        <p className="text-white font-medium">{accountAuth.email}</p>
                      </div>
                    )}

                    {accountAuth.uniqueCode && (
                      <div className="bg-black/30 rounded-xl p-4 border border-emerald-500/20">
                        <div className="flex items-center gap-2 mb-2">
                          <Key className="w-4 h-4 text-emerald-400" />
                          <span className="text-slate-400 text-sm">Codigo Unico:</span>
                        </div>
                        <code className="text-emerald-300 font-mono text-lg tracking-wider">
                          {formatCode(accountAuth.uniqueCode)}
                        </code>
                      </div>
                    )}

                    <div className="bg-black/30 rounded-xl p-4 border border-emerald-500/20">
                      <div className="flex items-center gap-2 mb-2">
                        <Cloud className="w-4 h-4 text-emerald-400" />
                        <span className="text-slate-400 text-sm">Ultimo salvamento:</span>
                      </div>
                      <p className="text-white font-medium">{formatLastSaved(accountAuth.lastSaved)}</p>
                      <p className="text-xs text-slate-500 mt-1">Salvamento automatico a cada 30 segundos</p>
                    </div>

                    <div className="flex gap-3">
                      <Button
                        onClick={handleManualSave}
                        className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 border border-emerald-400/50"
                      >
                        <Save className="w-4 h-4 mr-2" />
                        Salvar Agora
                      </Button>
                      <Button
                        onClick={logoutAccount}
                        variant="outline"
                        className="flex-1 border-red-500/50 text-red-400 hover:bg-red-500/20 bg-transparent"
                      >
                        <LogOut className="w-4 h-4 mr-2" />
                        Sair
                      </Button>
                    </div>

                    {saveMessage && (
  <p className="text-emerald-400 text-center text-sm animate-pulse bg-emerald-500/20 py-2 rounded-lg">
  {saveMessage}
  </p>
  )}
  
  </div>
  ) : generatedCode ? (
                  /* Show generated code after registration */
                  <div className="space-y-4">
                    <div className="bg-gradient-to-r from-emerald-500/20 to-teal-500/20 rounded-xl p-6 border border-emerald-400/50">
                      <div className="flex items-center gap-2 mb-3">
                        <Key className="w-5 h-5 text-emerald-400" />
                        <span className="text-emerald-400 font-bold">Conta Criada com Sucesso!</span>
                      </div>
                      <p className="text-slate-300 text-sm mb-4">
                        Guarde este codigo em um lugar seguro. Voce precisara dele junto com sua senha para acessar sua conta.
                      </p>
                      <div className="bg-black/50 rounded-xl p-4 border border-emerald-500/30">
                        <p className="text-slate-400 text-xs mb-2">Seu Codigo Unico:</p>
                        <code className="text-2xl font-mono text-emerald-300 tracking-widest block text-center">
                          {formatCode(generatedCode)}
                        </code>
                      </div>
                      <Button
                        onClick={handleCopyCode}
                        className="w-full mt-4 bg-emerald-600 hover:bg-emerald-500 border border-emerald-400/50"
                      >
                        {codeCopied ? (
                          <>
                            <Check className="w-4 h-4 mr-2" />
                            Copiado!
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4 mr-2" />
                            Copiar Codigo
                          </>
                        )}
                      </Button>
                    </div>
                    <Button
                      onClick={() => setGeneratedCode(null)}
                      variant="outline"
                      className="w-full border-slate-600 text-slate-300 hover:bg-slate-800 bg-transparent"
                    >
                      Fechar
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-slate-400 text-sm">
                      Conecte sua conta para salvar seu progresso permanentemente.
                    </p>

                    {/* Auth Type Toggle (Email or Code) */}
                    <div className="flex rounded-xl overflow-hidden border border-slate-600">
                      <button
                        onClick={() => { setAuthType("email"); setAuthError(""); }}
                        className={`flex-1 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                          authType === "email"
                            ? "bg-gradient-to-r from-cyan-600 to-blue-600 text-white"
                            : "bg-slate-800 text-slate-400 hover:text-white"
                        }`}
                      >
                        <Mail className="w-4 h-4" />
                        Email
                      </button>
                      <button
                        onClick={() => { setAuthType("code"); setAuthError(""); }}
                        className={`flex-1 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                          authType === "code"
                            ? "bg-gradient-to-r from-amber-600 to-orange-600 text-white"
                            : "bg-slate-800 text-slate-400 hover:text-white"
                        }`}
                      >
                        <Key className="w-4 h-4" />
                        Codigo Unico
                      </button>
                    </div>

                    {/* Auth Mode Toggle */}
                    <div className="flex rounded-xl overflow-hidden border border-slate-600">
                      <button
                        onClick={() => { setAuthMode("login"); setAuthError(""); }}
                        className={`flex-1 py-3 text-sm font-medium transition-colors ${
                          authMode === "login"
                            ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white"
                            : "bg-slate-800 text-slate-400 hover:text-white"
                        }`}
                      >
                        Entrar
                      </button>
                      <button
                        onClick={() => { setAuthMode("register"); setAuthError(""); }}
                        className={`flex-1 py-3 text-sm font-medium transition-colors ${
                          authMode === "register"
                            ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white"
                            : "bg-slate-800 text-slate-400 hover:text-white"
                        }`}
                      >
                        Registrar
                      </button>
                    </div>

                    {/* Email Auth Form */}
                    {authType === "email" && (
                      <>
                        <div>
                          <label className="text-sm text-slate-400 block mb-2">Email</label>
                          <div className="relative">
                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                            <Input
                              type="email"
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              placeholder="seu@email.com"
                              className="pl-12 bg-slate-900/80 border-emerald-500/30 text-white py-3"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="text-sm text-slate-400 block mb-2">Senha</label>
                          <div className="relative">
                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                            <Input
                              type="password"
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              placeholder="******"
                              className="pl-12 bg-slate-900/80 border-emerald-500/30 text-white py-3"
                            />
                          </div>
                        </div>

                        {authMode === "register" && (
                          <div>
                            <label className="text-sm text-slate-400 block mb-2">Confirmar Senha</label>
                            <div className="relative">
                              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                              <Input
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="******"
                                className="pl-12 bg-slate-900/80 border-emerald-500/30 text-white py-3"
                              />
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {/* Code Auth Form */}
                    {authType === "code" && (
                      <>
                        {authMode === "login" && (
                          <div>
                            <label className="text-sm text-slate-400 block mb-2">Codigo Unico</label>
                            <div className="relative">
                              <Hash className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                              <Input
                                type="text"
                                value={uniqueCode}
                                onChange={(e) => setUniqueCode(e.target.value.toUpperCase())}
                                placeholder="XXXX-XXXX-XXXX"
                                className="pl-12 bg-slate-900/80 border-amber-500/30 text-white py-3 font-mono tracking-wider"
                                maxLength={14}
                              />
                            </div>
                          </div>
                        )}

                        {authMode === "register" && (
                          <div className="bg-amber-500/10 rounded-xl p-4 border border-amber-500/30">
                            <p className="text-amber-300 text-sm">
                              Um codigo unico de 12 caracteres sera gerado automaticamente para voce. Guarde-o em um lugar seguro!
                            </p>
                          </div>
                        )}

                        <div>
                          <label className="text-sm text-slate-400 block mb-2">Senha</label>
                          <div className="relative">
                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                            <Input
                              type="password"
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              placeholder="******"
                              className="pl-12 bg-slate-900/80 border-amber-500/30 text-white py-3"
                            />
                          </div>
                        </div>

                        {authMode === "register" && (
                          <div>
                            <label className="text-sm text-slate-400 block mb-2">Confirmar Senha</label>
                            <div className="relative">
                              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                              <Input
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="******"
                                className="pl-12 bg-slate-900/80 border-amber-500/30 text-white py-3"
                              />
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {/* Error Message */}
                    {authError && (
                      <p className="text-red-400 text-sm text-center bg-red-500/20 py-2 rounded-lg">{authError}</p>
                    )}

                    {/* Submit Button */}
                    <Button
                      onClick={
                        authType === "email"
                          ? authMode === "login"
                            ? handleLogin
                            : handleRegister
                          : authMode === "login"
                            ? handleLoginWithCode
                            : handleRegisterWithCode
                      }
                      disabled={authLoading}
                      className={`w-full py-3 border ${
                        authType === "email"
                          ? "bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 border-emerald-400/50"
                          : "bg-gradient-to-r from-amber-600 to-orange-500 hover:from-amber-500 hover:to-orange-400 border-amber-400/50"
                      }`}
                    >
                      {authLoading ? (
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <>
                          {authType === "email" ? <LogIn className="w-4 h-4 mr-2" /> : <Key className="w-4 h-4 mr-2" />}
                          {authMode === "login" ? "Entrar" : authType === "code" ? "Gerar Codigo e Criar Conta" : "Criar Conta"}
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>

              {/* Delete Data Section - always visible */}
              <div className="bg-gradient-to-r from-red-950/60 to-rose-950/60 rounded-2xl p-6 border border-red-500/40 backdrop-blur-sm">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-600 to-rose-700 flex items-center justify-center shadow-lg shadow-red-900/40">
                    <Trash2 className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">Delete Data</h2>
                    <p className="text-red-300/70 text-xs">Apaga todos os dados do jogo</p>
                  </div>
                </div>

                <div className="bg-black/30 rounded-xl p-4 border border-red-500/15 mb-4">
                  <p className="text-slate-300 text-sm leading-relaxed">
                    Apaga permanentemente todos os seus dados de jogo — cartas, decks, moedas, histórico e progresso — mas mantém sua conta logada pelo email/código.
                  </p>
                </div>

                {!showDeleteConfirm ? (
                  <Button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="w-full py-4 bg-gradient-to-r from-red-700 to-rose-700 hover:from-red-600 hover:to-rose-600 border border-red-500/50 text-white font-bold text-base shadow-lg shadow-red-900/30 transition-all"
                  >
                    <Trash2 className="w-5 h-5 mr-2" />
                    Deletar Todos os Dados
                  </Button>
                ) : (
                  <div className="bg-red-500/10 rounded-xl p-4 border border-red-500/40 space-y-3 animate-fadeIn">
                    <div className="flex items-center gap-2 text-red-400">
                      <AlertTriangle className="w-5 h-5" />
                      <span className="font-bold text-base">Confirmar Exclusão</span>
                    </div>
                    <p className="text-slate-300 text-sm">
                      Esta ação <span className="text-red-400 font-semibold">não pode ser desfeita</span>. Serão apagados:
                    </p>
                    <div className="grid grid-cols-2 gap-1.5 text-xs text-slate-400">
                      <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />Todas as cartas</span>
                      <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />Todos os decks</span>
                      <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />Histórico de partidas</span>
                      <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />Moedas e progresso</span>
                      <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />Códigos resgatados</span>
                      <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />Playmats obtidos</span>
                    </div>
                    <div className="flex items-center gap-2 bg-amber-500/10 rounded-lg px-3 py-2 border border-amber-500/20">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                      <p className="text-amber-300 text-xs">
                        Sua conta permanecerá logada com o email/código atual.
                      </p>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button
                        onClick={() => setShowDeleteConfirm(false)}
                        variant="outline"
                        className="flex-1 border-slate-600/80 text-slate-300 hover:bg-slate-700 bg-transparent"
                      >
                        Cancelar
                      </Button>
                      <Button
                        onClick={handleDeleteAccount}
                        disabled={deleteLoading}
                        className="flex-1 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 border border-red-400/50 font-bold"
                      >
                        {deleteLoading ? (
                          <div className="flex items-center gap-2">
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Deletando...
                          </div>
                        ) : "Sim, Deletar Tudo"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Player ID Section */}
              <div className="bg-gradient-to-r from-amber-900/40 to-yellow-900/40 rounded-2xl p-6 border border-amber-500/40 backdrop-blur-sm">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-yellow-600 flex items-center justify-center shadow-lg">
                    <User className="w-5 h-5 text-white" />
                  </div>
                  <h2 className="text-xl font-bold text-white">ID do Jogador</h2>
                </div>
                <p className="text-slate-400 text-sm mb-4">
                  Use este ID para que outros jogadores possam te adicionar como amigo.
                </p>
                <div className="flex items-center gap-3">
                  <code className="flex-1 bg-black/50 px-5 py-4 rounded-xl text-xl font-mono text-amber-300 tracking-wider border border-amber-500/30">
                    {playerId}
                  </code>
                  <Button
                    onClick={handleCopyId}
                    variant="outline"
                    className="border-amber-500/50 text-amber-400 hover:bg-amber-500/20 bg-transparent px-4 py-4"
                  >
                    {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                  </Button>
                </div>
              </div>

              {/* Profile Section */}
              <div className="bg-gradient-to-r from-slate-800/80 to-cyan-900/30 rounded-2xl p-6 border border-cyan-500/30 backdrop-blur-sm">
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg">
                      <Sparkles className="w-5 h-5 text-white" />
                    </div>
                    <h2 className="text-xl font-bold text-white">Perfil</h2>
                  </div>
                  {!isEditing ? (
                    <Button
                      onClick={() => {
                        setIsEditing(true)
                        setEditName(playerProfile.name)
                        setEditTitle(playerProfile.title)
                        setEditAvatarUrl(playerProfile.avatarUrl || "")
                      }}
                      variant="ghost"
                      size="sm"
                      className="text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/20"
                    >
                      <Edit2 className="w-4 h-4 mr-1" />
                      Editar
                    </Button>
                  ) : (
                    <Button
                      onClick={handleSaveProfile}
                      size="sm"
                      className="bg-gradient-to-r from-green-600 to-emerald-500 hover:from-green-500 hover:to-emerald-400"
                    >
                      <Save className="w-4 h-4 mr-1" />
                      Salvar
                    </Button>
                  )}
                </div>

                <div className="space-y-4">
                  {/* Avatar Section */}
                  <div>
                    <label className="text-sm text-slate-400 block mb-2">Foto de Perfil</label>
                    <div className="flex items-center gap-4">
                      <div className="relative">
                        <div className="w-20 h-20 rounded-full overflow-hidden border-[3px] border-cyan-400/50 shadow-lg">
                          {(isEditing ? editAvatarUrl : playerProfile.avatarUrl) ? (
                            <Image
                              src={isEditing ? editAvatarUrl : playerProfile.avatarUrl || "/placeholder.svg"}
                              alt="Avatar"
                              width={80}
                              height={80}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center">
                              <User className="w-8 h-8 text-slate-400" />
                            </div>
                          )}
                        </div>
                      </div>
                      {isEditing && (
                        <Button
                          onClick={() => setShowIconPicker(!showIconPicker)}
                          variant="outline"
                          size="sm"
                          className="border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/20 bg-transparent"
                        >
                          <Edit2 className="w-4 h-4 mr-1" />
                          Trocar
                        </Button>
                      )}
                    </div>

                    {/* Icon Picker */}
                    {isEditing && showIconPicker && (
                      <div className="mt-4 p-4 bg-black/30 rounded-xl border border-cyan-500/20">
                        <p className="text-slate-400 text-sm mb-3">Selecione um avatar:</p>
                        <div className="grid grid-cols-3 gap-3">
                          {PROFILE_ICONS.map((icon) => (
                            <button
                              key={icon.id}
                              onClick={() => {
                                setEditAvatarUrl(icon.image)
                                setShowIconPicker(false)
                              }}
                              className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all duration-200 ${
                                editAvatarUrl === icon.image
                                  ? "border-cyan-400 scale-105 shadow-lg shadow-cyan-500/40"
                                  : "border-slate-600 hover:border-slate-400"
                              }`}
                            >
                              <Image
                                src={icon.image || "/placeholder.svg"}
                                alt={icon.name}
                                fill
                                className="object-cover"
                              />
                              {editAvatarUrl === icon.image && (
                                <div className="absolute inset-0 bg-cyan-400/20 flex items-center justify-center">
                                  <Check className="w-6 h-6 text-white" />
                                </div>
                              )}
                              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-1">
                                <p className="text-white text-[10px] font-medium text-center truncate">{icon.name}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="text-sm text-slate-400 block mb-2">Nome</label>
                    {isEditing ? (
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="bg-slate-900/80 border-cyan-500/30 text-white"
                        maxLength={20}
                      />
                    ) : (
                      <p className="text-white font-medium text-lg">{playerProfile.name}</p>
                    )}
                  </div>
                  <div>
                    <label className="text-sm text-slate-400 block mb-2">Titulo</label>
                    {isEditing ? (
                      <Input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="bg-slate-900/80 border-cyan-500/30 text-white"
                        maxLength={30}
                      />
                    ) : (
                      <p className="text-cyan-400 font-medium">{playerProfile.title}</p>
                    )}
                  </div>
                  <div>
                    <label className="text-sm text-slate-400 block mb-2">Level</label>
                    <p className="text-white font-medium text-lg">{playerProfile.level}</p>
                  </div>
                </div>
              </div>
            </>
          )}

          {activeTab === "codes" && (
            <div className="space-y-4">
              {/* Code Redemption Section */}
              <div className="bg-gradient-to-r from-emerald-900/40 to-teal-900/40 rounded-2xl p-6 border border-emerald-500/40 backdrop-blur-sm">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg">
                    <Gift className="w-5 h-5 text-white" />
                  </div>
                  <h2 className="text-xl font-bold text-white">Resgatar Codigo</h2>
                </div>
                
                <p className="text-slate-400 text-sm mb-4">
                  Digite um codigo promocional para receber recompensas especiais.
                </p>
                
                <div className="space-y-3">
                  <div className="relative">
                    <Key className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <Input
                      type="text"
                      value={codeInput}
                      onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                      placeholder="DIGITE O CODIGO"
                      className="pl-12 bg-slate-900/80 border-emerald-500/30 text-white py-3 uppercase tracking-widest font-mono"
                      maxLength={20}
                    />
                  </div>
                  
                  <Button
                    onClick={handleRedeemCode}
                    disabled={codeLoading || !codeInput.trim()}
                    className="w-full bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 border border-emerald-400/50"
                  >
                    {codeLoading ? "Verificando..." : "Resgatar Codigo"}
                  </Button>
                  
                  {codeMessage && (
                    <div className={`p-3 rounded-lg text-center text-sm ${
                      codeMessage.type === "success" 
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" 
                        : "bg-red-500/20 text-red-400 border border-red-500/30"
                    }`}>
                      {codeMessage.text}
                    </div>
                  )}
                </div>
              </div>
              
              {/* Redeemed Codes History */}
              <div className="bg-gradient-to-r from-slate-800/80 to-slate-900/80 rounded-2xl p-6 border border-slate-600/40 backdrop-blur-sm">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center">
                    <Check className="w-4 h-4 text-emerald-400" />
                  </div>
                  <h3 className="text-lg font-bold text-white">Codigos Resgatados</h3>
                </div>
                
                {redeemedCodes.length > 0 ? (
                  <div className="space-y-2">
                    {redeemedCodes.map((code) => (
                      <div 
                        key={code}
                        className="flex items-center gap-2 bg-slate-900/60 rounded-lg px-4 py-2 border border-emerald-500/20"
                      >
                        <Check className="w-4 h-4 text-emerald-400" />
                        <code className="text-emerald-300 font-mono tracking-wider">{code}</code>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-500 text-sm text-center py-4">
                    Nenhum codigo resgatado ainda.
                  </p>
                )}
              </div>
              
              {/* Available Codes Hint */}
              <div className="bg-gradient-to-r from-amber-900/20 to-orange-900/20 rounded-xl p-4 border border-amber-500/30">
                <div className="flex items-start gap-3">
                  <Sparkles className="w-5 h-5 text-amber-400 mt-0.5" />
                  <div>
                    <p className="text-amber-400 font-medium text-sm">Dica</p>
                    <p className="text-slate-400 text-xs mt-1">
                      Fique atento as redes sociais oficiais do Gear Perks para novos codigos promocionais!
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "display" && (
            <div className="space-y-4">
              {/* Mobile Mode Card */}
              <div className="bg-gradient-to-r from-slate-800/80 to-sky-900/30 rounded-2xl p-6 border border-sky-500/30 backdrop-blur-sm">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-cyan-600 flex items-center justify-center shadow-lg">
                    <Smartphone className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">Modo Mobile</h2>
                    <p className="text-slate-400 text-xs">Otimiza a resolucao para celulares</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="bg-black/30 rounded-xl p-4 border border-sky-500/15">
                    <p className="text-slate-300 text-sm leading-relaxed">
                      Ao ativar o Modo Mobile, todos os elementos do jogo, incluindo botoes, cartas e areas de duelo, serao redimensionados e reorganizados para proporcionar a melhor experiencia possivel em dispositivos moveis.
                    </p>
                  </div>

                  {/* Current status */}
                  <div className="flex items-center justify-between bg-black/20 rounded-xl px-4 py-3 border border-slate-700/50">
                    <div className="flex items-center gap-3">
                      {mobileMode ? (
                        <Smartphone className="w-5 h-5 text-emerald-400" />
                      ) : (
                        <Monitor className="w-5 h-5 text-slate-400" />
                      )}
                      <div>
                        <p className="text-white text-sm font-medium">
                          {mobileMode ? "Modo Mobile Ativo" : "Modo Desktop"}
                        </p>
                        <p className="text-slate-500 text-xs">
                          {mobileMode ? "Resolucao otimizada para celulares" : "Resolucao padrao para PC"}
                        </p>
                      </div>
                    </div>
                    <div className={`w-3 h-3 rounded-full ${mobileMode ? "bg-emerald-400 shadow-lg shadow-emerald-400/50" : "bg-slate-600"}`} />
                  </div>

                  {/* Toggle Button */}
                  <Button
                    onClick={handleMobileModeToggle}
                    className={`w-full py-4 text-lg font-bold rounded-xl transition-all ${
                      mobileMode
                        ? "bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 border border-red-400/50"
                        : "bg-gradient-to-r from-sky-600 to-cyan-600 hover:from-sky-500 hover:to-cyan-500 border border-sky-400/50 shadow-lg shadow-sky-500/20"
                    }`}
                  >
                    {mobileMode ? (
                      <>
                        <Monitor className="w-5 h-5 mr-2" />
                        Desativar Modo Mobile
                      </>
                    ) : (
                      <>
                        <Smartphone className="w-5 h-5 mr-2" />
                        Ativar Modo Mobile
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {/* Mobile Mode Confirmation Dialog */}
              {showMobileConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                  <div className="bg-gradient-to-b from-slate-800 to-slate-900 rounded-2xl p-6 border border-sky-500/40 max-w-sm w-full shadow-2xl shadow-sky-500/10">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-sky-500 to-cyan-600 flex items-center justify-center shadow-lg">
                        <Smartphone className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-white">Ativar Modo Mobile</h3>
                        <p className="text-sky-400 text-xs font-medium">
                          {detectedDevice === "mobile" ? "Dispositivo movel detectado" : "Dispositivo PC detectado"}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-3 mb-6">
                      {detectedDevice === "mobile" ? (
                        <div className="bg-emerald-500/10 rounded-xl p-4 border border-emerald-500/30">
                          <p className="text-emerald-300 text-sm leading-relaxed">
                            Detectamos que voce esta usando um dispositivo movel. Deseja ativar o Modo Mobile para otimizar a resolucao e a experiencia de jogo?
                          </p>
                        </div>
                      ) : (
                        <div className="bg-amber-500/10 rounded-xl p-4 border border-amber-500/30">
                          <p className="text-amber-300 text-sm leading-relaxed">
                            Detectamos que voce esta usando um PC. O Modo Mobile e projetado para celulares, mas pode ser ativado para testes ou preferencia pessoal. Deseja continuar?
                          </p>
                        </div>
                      )}

                      <div className="bg-black/30 rounded-xl p-3 border border-slate-700/50">
                        <p className="text-slate-400 text-xs leading-relaxed">
                          O jogo sera ajustado com botoes maiores, fontes adaptadas e layout otimizado para telas menores. Voce pode desativar a qualquer momento nas configuracoes.
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <Button
                        onClick={() => setShowMobileConfirm(false)}
                        variant="outline"
                        className="flex-1 border-slate-600 text-slate-300 hover:bg-slate-700 bg-transparent"
                      >
                        Cancelar
                      </Button>
                      <Button
                        onClick={confirmMobileMode}
                        className="flex-1 bg-gradient-to-r from-sky-600 to-cyan-600 hover:from-sky-500 hover:to-cyan-500 border border-sky-400/50 shadow-lg shadow-sky-500/20"
                      >
                        <Check className="w-4 h-4 mr-2" />
                        Confirmar
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Credits */}
          <div className="mt-8 text-center text-slate-500 text-sm py-4">
            <p className="font-medium">2025 Gear Perks Oficial Card Game</p>
            <p>Made in BRAZIL</p>
          </div>
        </div>
      </div>
    </div>
  )
}
