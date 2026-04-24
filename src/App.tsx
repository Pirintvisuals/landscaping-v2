import { useState, useEffect, useRef } from 'react'
import {
  createInitialState,
  updateStateWithExtraction,
  getNextQuestion,
  generateAcknowledgment,
  isReadyForEstimate,
  detectCurrentField,
  isRelevantFieldExtracted,
  incrementRetryCount,
  resetRetryCount,
  type ChatMessage,
  type ConversationState,
  type ExtractedInfo
} from './conversationManager'
import { getFallbackQuickReplies, getQuickReplies, WRITE_IT_OUT, type QuickReply } from './quickReplies'
import {
  calculateUKEstimate,
  formatCurrencyGBP,
  type EstimateResult,
  type ProjectInputs
} from './qouter'
import DOMPurify from 'dompurify'
import { estimatorSchema, contactSchema } from './schemas/estimator'

// ── Demo / Preview Mode ──────────────────────────────────────────────────────
const DEMO_MODE = true

const DEMO_ESTIMATE: EstimateResult = {
  lowerBound: 480,
  estimate: 620,
  upperBound: 790,
  lineItems: [
    { label: 'Hedge Trimming (3 hedges)', amount: 390, note: '3 × medium hedge ~£130/each', kind: 'labor' },
    { label: 'Green Waste Removal', amount: 120, note: 'bagging & disposal included', kind: 'fee' },
    { label: 'Site Tidy & Clear-up', amount: 80, note: 'post-work sweep', kind: 'labor' },
    { label: 'Contingency Reserve', amount: 30, note: '5% contingency allowance', kind: 'fee' },
  ],
  reasoning: `3 medium hedges (~2m tall) along back fence. Easy side-gate access confirmed.\n\nGreen waste removal and full site tidy included in price.`,
  projectStatus: 'VIP PRIORITY' as const
}
// ─────────────────────────────────────────────────────────────────────────────

function calcLeadScore(state: ConversationState, estimate: EstimateResult | null): number {
  let score = 0
  if (state.fullName) score += 20
  if (state.contactPhone) score += 15
  if (state.contactEmail) score += 15
  if (state.postalCode) score += 10
  if (state.projectStartTiming) score += 10
  if (state.userBudget) score += 10
  if (state.userBudget && estimate) {
    const ratio = state.userBudget / estimate.estimate
    if (ratio >= 0.7 && ratio <= 1.4) score += 20
  }
  return Math.min(score, 100)
}

function getScoreColor(score: number): string {
  if (score >= 80) return '#15803d'
  if (score >= 55) return '#b45309'
  return '#dc2626'
}

function getScoreLabel(score: number): string {
  if (score >= 80) return 'Hot Lead'
  if (score >= 55) return 'Warm Lead'
  return 'Cold Lead'
}

function App() {
  const [state, setState] = useState<ConversationState>(createInitialState())
  const [input, setInput] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [estimate, setEstimate] = useState<EstimateResult | null>(null)
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([])
  const [isOpen, setIsOpen] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [_emailSent, setEmailSent] = useState(false)
  const [_sendingEmail, setSendingEmail] = useState(false)

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [state.messageHistory])

  // Mount: either load demo completed state or show initial greeting
  useEffect(() => {
    if (DEMO_MODE) {
      const ts = new Date()
      const demoMessages: ChatMessage[] = [
        { id: 'dm-1', role: 'agent', content: "Hi! What kind of work are you looking for? Hedge trimming / Tree removal / Tree pruning / Stump grinding — or something else?", timestamp: ts },
        { id: 'dm-2', role: 'user', content: "Hedge trimming please", timestamp: ts },
        { id: 'dm-3', role: 'agent', content: "Great. Roughly how tall are the hedges?", timestamp: ts },
        { id: 'dm-4', role: 'user', content: "About 2 metres high", timestamp: ts },
        { id: 'dm-5', role: 'agent', content: "And how many hedges need doing?", timestamp: ts },
        { id: 'dm-6', role: 'user', content: "3 hedges along the back fence", timestamp: ts },
        { id: 'dm-7', role: 'agent', content: "Is there easy access — any gates, fences, or obstacles to get around?", timestamp: ts },
        { id: 'dm-8', role: 'user', content: "Easy access, side gate leads straight to them", timestamp: ts },
        { id: 'dm-9', role: 'agent', content: "What's your postcode?", timestamp: ts },
        { id: 'dm-10', role: 'user', content: "GU21 5NX", timestamp: ts },
        { id: 'dm-11', role: 'agent', content: "What's your rough budget — or are you unsure?", timestamp: ts },
        { id: 'dm-12', role: 'user', content: "Around £500", timestamp: ts },
        { id: 'dm-13', role: 'agent', content: "What's your name?", timestamp: ts },
        { id: 'dm-14', role: 'user', content: "Daniel Myers", timestamp: ts },
        { id: 'dm-15', role: 'agent', content: "Best phone number, Daniel?", timestamp: ts },
        { id: 'dm-16', role: 'user', content: "07512 334 891", timestamp: ts },
        { id: 'dm-17', role: 'agent', content: "And your email address?", timestamp: ts },
        { id: 'dm-18', role: 'user', content: "d.myers@hotmail.co.uk", timestamp: ts },
        { id: 'dm-19', role: 'agent', content: "When are you looking to get this done?", timestamp: ts },
        { id: 'dm-20', role: 'user', content: "Next few weeks if possible", timestamp: ts },
        { id: 'dm-21', role: 'agent', content: "Thanks Daniel, putting your estimate together now...", timestamp: ts },
        { id: 'dm-22', role: 'estimate', content: '', timestamp: ts }
      ]
      setState(prev => ({
        ...prev,
        messageHistory: demoMessages,
        service: 'softscaping',
        area_m2: 0,
        materialTier: 'standard',
        hasExcavatorAccess: true,
        hasDrivewayForSkip: true,
        slopeLevel: 'flat',
        existingDemolition: false,
        fullName: 'Daniel Myers',
        contactPhone: '07512 334 891',
        contactEmail: 'd.myers@hotmail.co.uk',
        postalCode: 'GU21 5NX',
        userBudget: 500,
        projectStartTiming: 'Next few weeks'
      }))
      setEstimate(DEMO_ESTIMATE)
    } else {
      const greeting: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'agent',
        content: "Hi! What kind of work are you looking for? Hedge trimming / Tree removal / Tree pruning / Stump grinding — or something else?",
        timestamp: new Date()
      }
      setState(prev => ({
        ...prev,
        messageHistory: [greeting]
      }))
    }
  }, [])

  // @ts-ignore
  const _handleSubmitLead = async () => {
    if (!estimate) return

    setSendingEmail(true)

    try {
      const rawLeadData = {
        fullName: state.fullName || 'N/A',
        contactPhone: state.contactPhone || 'N/A',
        contactEmail: state.contactEmail || 'N/A',
        userBudget: state.userBudget || 0,
        estimatedCost: estimate.estimate,
        projectStatus: estimate.projectStatus,
        service: state.service || 'unknown',
        area: state.area_m2 || 0,
        postalCode: state.postalCode,
        projectStartTiming: state.projectStartTiming || 'Not specified',
        groundSoilType: state.groundSoilType || 'Not specified',
        hasExcavatorAccess: state.hasExcavatorAccess
      }

      try {
        contactSchema.parse({
          fullName: rawLeadData.fullName,
          contactPhone: rawLeadData.contactPhone,
          contactEmail: rawLeadData.contactEmail,
          userBudget: rawLeadData.userBudget
        })
      } catch (validationError) {
        console.error('Validation failed:', validationError)
        alert('Please check your contact details. They appear to be invalid.')
        setSendingEmail(false)
        return
      }

      const leadData = {
        ...rawLeadData,
        fullName: DOMPurify.sanitize(rawLeadData.fullName),
        contactPhone: DOMPurify.sanitize(rawLeadData.contactPhone),
        contactEmail: DOMPurify.sanitize(rawLeadData.contactEmail),
        projectStartTiming: DOMPurify.sanitize(rawLeadData.projectStartTiming),
        groundSoilType: DOMPurify.sanitize(rawLeadData.groundSoilType)
      }

      const response = await fetch('/api/send-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(leadData)
      })

      if (response.ok) {
        setEmailSent(true)
        const successMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'agent',
          content: '✅ **Request Received.** Sent to Tree Hedge Care.',
          timestamp: new Date()
        }
        setState(prev => ({
          ...prev,
          messageHistory: [...prev.messageHistory, successMsg]
        }))
      } else {
        throw new Error('Failed to send')
      }
    } catch (error) {
      console.error('Email send error:', error)
      setEmailSent(true)
      const successMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'agent',
        content: '✅ **Request Received.** Sent to Tree Hedge Care.',
        timestamp: new Date()
      }
      setState(prev => ({
        ...prev,
        messageHistory: [...prev.messageHistory, successMsg]
      }))
    } finally {
      setSendingEmail(false)
    }
  }

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!input.trim() || isProcessing) return

    const sanitizedInput = DOMPurify.sanitize(input.trim())
    if (!sanitizedInput) return

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: sanitizedInput,
      timestamp: new Date()
    }

    setState(prev => ({
      ...prev,
      messageHistory: [...prev.messageHistory, userMessage]
    }))

    setInput('')
    setIsProcessing(true)

    try {
      let extracted: ExtractedInfo = {}

      try {
        const response = await fetch('/api/conversation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userMessage: userMessage.content,
            conversationState: state
          })
        })

        if (response.ok) {
          const data = await response.json()
          extracted = data.extracted || {}
          if (data.agentResponse) {
            extracted.agentResponse = data.agentResponse
          }
        } else {
          throw new Error('API not available')
        }
      } catch (apiError) {
        console.error('⚠️ API unavailable or failed:', apiError)
      }

      const currentField = detectCurrentField(state)
      const updatedState = updateStateWithExtraction(state, extracted, currentField)

      let stateWithRetry = updatedState
      const relevantFieldExtracted = isRelevantFieldExtracted(currentField, extracted, state, updatedState)

      if (currentField === 'postalCode' && !relevantFieldExtracted && sanitizedInput.length > 1) {
        stateWithRetry.postalCode = sanitizedInput.toUpperCase()
        stateWithRetry = resetRetryCount(stateWithRetry)
      } else if (!relevantFieldExtracted) {
        stateWithRetry = incrementRetryCount(updatedState, currentField)
        if (stateWithRetry.showQuickReplies) {
          const fallbackReplies = getFallbackQuickReplies(currentField, stateWithRetry)
          setQuickReplies(fallbackReplies)
        }
      } else {
        stateWithRetry = resetRetryCount(updatedState)
        setQuickReplies([])
      }

      const ack = generateAcknowledgment(stateWithRetry, extracted)
      const nextQ = getNextQuestion(stateWithRetry)

      let agentContent = ''
      const hasAIResponse = !!extracted.agentResponse

      if (hasAIResponse) {
        agentContent = extracted.agentResponse!
      } else {
        if (ack) agentContent += ack + ' '
      }

      if (isReadyForEstimate(stateWithRetry) && !nextQ) {
        const serviceName = stateWithRetry.service || 'tree surgery'
        agentContent += `I've gathered everything. We have limited availability this month — I'll send this straight to our team now. ${serviceName}`

        const agentMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'agent',
          content: agentContent.trim(),
          timestamp: new Date()
        }

        setState(prev => ({
          ...stateWithRetry,
          messageHistory: [...prev.messageHistory, agentMessage],
          awaitingEstimate: true
        }))

        setTimeout(() => {
          generateEstimate(stateWithRetry)
        }, 1000)

      } else if (nextQ) {
        if (stateWithRetry.showQuickReplies) {
          agentContent = "Apologies, I didn't catch that. Could you please select an option below or clarify?"
        } else if (!hasAIResponse) {
          agentContent += nextQ
        }

        const agentMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'agent',
          content: agentContent.trim(),
          timestamp: new Date()
        }

        setState(prev => ({
          ...stateWithRetry,
          messageHistory: [...prev.messageHistory, agentMessage]
        }))
      } else {
        const agentMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'agent',
          content: agentContent.trim() || ack || "I understand. Could you tell me a bit more?",
          timestamp: new Date()
        }

        setState(prev => ({
          ...stateWithRetry,
          messageHistory: [...prev.messageHistory, agentMessage]
        }))
      }

    } catch (error) {
      console.error('Failed to process message:', error)

      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'agent',
        content: "Sorry, I had trouble processing that. Could you rephrase?",
        timestamp: new Date()
      }

      setState(prev => ({
        ...prev,
        messageHistory: [...prev.messageHistory, errorMessage]
      }))
    } finally {
      setIsProcessing(false)
    }
  }

  const handleQuickReply = (value: string) => {
    if (value === WRITE_IT_OUT) {
      inputRef.current?.focus()
      return
    }
    setInput(value)
    handleSend({ preventDefault: () => { } } as React.FormEvent)
  }

  const generateEstimate = (conversationState: ConversationState) => {
    let inputs: ProjectInputs | undefined;
    try {
      inputs = {
        service: conversationState.service || 'softscaping',
        hasExcavatorAccess: conversationState.hasExcavatorAccess ?? true,
        hasDrivewayForSkip: conversationState.hasDrivewayForSkip ?? true,
        slopeLevel: conversationState.slopeLevel || 'flat',
        subBaseType: conversationState.subBaseType || 'dirt',
        existingDemolition: conversationState.existingDemolition ?? false,
        length_m: conversationState.length_m || 0,
        width_m: conversationState.width_m || 0,
        area_m2: conversationState.area_m2 || (conversationState.length_m || 0) * (conversationState.width_m || 0),
        materialTier: conversationState.materialTier || 'standard',
        deckHeight_m: conversationState.deckHeight_m || undefined
      }

      const safeInputs = estimatorSchema.parse(inputs)
      const result = calculateUKEstimate(safeInputs as ProjectInputs)
      setEstimate(result)

      const estimateMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'estimate',
        content: '',
        timestamp: new Date()
      }

      setState(prev => ({
        ...prev,
        messageHistory: [...prev.messageHistory, estimateMessage]
      }))

    } catch (error) {
      console.error('Failed to generate estimate:', error)
      if (inputs) console.error('Inputs causing error:', inputs)

      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'agent',
        content: "I'm having trouble calculating that estimate. Could you verify the project details?",
        timestamp: new Date()
      }

      setState(prev => ({
        ...prev,
        messageHistory: [...prev.messageHistory, errorMessage],
        awaitingEstimate: false
      }))
    }
  }

  const activeReplies = state.showQuickReplies ? quickReplies : getQuickReplies(state)
  const leadScore = calcLeadScore(state, estimate)

  return (
    <>
      {/* Dark backdrop so widget is visible against any background */}
      <div style={{ position: 'fixed', inset: 0, backgroundColor: '#0f1e0f', zIndex: 0 }} />

      {/* Corner Widget */}
      <div style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: '12px'
      }}>

        {/* Chat Panel */}
        {isOpen && (
          <div style={{
            width: '420px',
            height: '700px',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: '#f0fdf4',
            borderRadius: '18px',
            overflow: 'hidden',
            boxShadow: '0 24px 80px rgba(0,0,0,0.45), 0 4px 20px rgba(21,128,61,0.2)',
            border: '1px solid #16a34a'
          }}>

            {/* Header */}
            <header style={{
              backgroundColor: '#15803d',
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <img
                  src="/tree-hedge-care-logo.jpg"
                  alt="Tree Hedge Care"
                  style={{ height: '38px', width: 'auto', borderRadius: '6px', backgroundColor: '#fff', padding: '2px' }}
                />
                <div>
                  <div style={{ color: '#ffffff', fontWeight: 700, fontSize: '14px', letterSpacing: '-0.2px' }}>Tree Hedge Care</div>
                  <div style={{ color: '#bbf7d0', fontSize: '11px' }}>Tree Surgery · Hedge Trimming · Stump Grinding</div>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                style={{ color: '#bbf7d0', background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', lineHeight: 1, padding: '4px' }}
              >
                ✕
              </button>
            </header>

            {/* Messages Area */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {state.messageHistory.map((message) => {

                if (message.role === 'agent') {
                  return (
                    <div key={message.id} style={{ display: 'flex', justifyContent: 'flex-start' }}>
                      <div style={{
                        backgroundColor: '#ffffff',
                        color: '#14532d',
                        border: '1px solid #bbf7d0',
                        borderRadius: '16px 16px 16px 4px',
                        padding: '10px 14px',
                        maxWidth: '82%',
                        fontSize: '13px',
                        lineHeight: 1.5,
                        boxShadow: '0 1px 4px rgba(0,0,0,0.06)'
                      }}>
                        <p
                          style={{ margin: 0 }}
                          dangerouslySetInnerHTML={{
                            __html: DOMPurify.sanitize(message.content.replace(
                              /\*\*(.+?)\*\*/g,
                              '<strong>$1</strong>'
                            ))
                          }}
                        />
                      </div>
                    </div>
                  )
                }

                if (message.role === 'user') {
                  return (
                    <div key={message.id} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <div style={{
                        backgroundColor: '#16a34a',
                        color: '#ffffff',
                        borderRadius: '16px 16px 4px 16px',
                        padding: '10px 14px',
                        maxWidth: '82%',
                        fontSize: '13px',
                        lineHeight: 1.5
                      }}>
                        <p style={{ margin: 0 }}>{message.content}</p>
                      </div>
                    </div>
                  )
                }

                if (message.role === 'estimate' && estimate) {
                  return (
                    <div key={message.id} style={{ margin: '4px 0' }}>
                      <div style={{
                        backgroundColor: '#ffffff',
                        borderRadius: '16px',
                        overflow: 'hidden',
                        border: '1px solid #86efac',
                        boxShadow: '0 8px 30px rgba(21,128,61,0.15)'
                      }}>

                        {/* New Enquiry bar */}
                        <div style={{
                          backgroundColor: '#14532d',
                          padding: '8px 16px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center'
                        }}>
                          <span style={{ color: '#ffffff', fontWeight: 800, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                            New Enquiry
                          </span>
                          <span style={{ color: '#86efac', fontSize: '10px' }}>
                            Today at {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true })}
                          </span>
                        </div>

                        {/* Logo */}
                        <div style={{
                          backgroundColor: '#f0fdf4',
                          padding: '14px',
                          display: 'flex',
                          justifyContent: 'center',
                          borderBottom: '1px solid #bbf7d0'
                        }}>
                          <img
                            src="/tree-hedge-care-logo.jpg"
                            alt="Tree Hedge Care"
                            style={{ height: '64px', width: 'auto' }}
                          />
                        </div>

                        {/* Estimate amount */}
                        <div style={{ padding: '18px 20px 10px', textAlign: 'center', backgroundColor: '#ffffff' }}>
                          <p style={{ fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.18em', marginBottom: '4px', margin: '0 0 4px' }}>
                            Estimated Cost
                          </p>
                          <p style={{ fontSize: '3.2rem', fontWeight: 900, color: '#15803d', letterSpacing: '-2px', lineHeight: 1, margin: 0 }}>
                            {formatCurrencyGBP(estimate.estimate)}
                          </p>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginTop: '8px' }}>
                            <span style={{ fontSize: '11px', color: '#9ca3af' }}>{formatCurrencyGBP(estimate.lowerBound)}</span>
                            <div style={{ flex: 1, maxWidth: '70px', height: '4px', borderRadius: '2px', backgroundColor: '#dcfce7', position: 'relative' }}>
                              <div style={{ position: 'absolute', top: 0, bottom: 0, left: '25%', right: '25%', backgroundColor: '#16a34a', borderRadius: '2px' }} />
                            </div>
                            <span style={{ fontSize: '11px', color: '#9ca3af' }}>{formatCurrencyGBP(estimate.upperBound)}</span>
                          </div>
                          <p style={{ fontSize: '10px', color: '#9ca3af', margin: '4px 0 0' }}>indicative range</p>
                        </div>

                        {/* Lead Score */}
                        <div style={{
                          padding: '10px 20px',
                          backgroundColor: '#f0fdf4',
                          borderTop: '1px solid #dcfce7',
                          borderBottom: '1px solid #dcfce7'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                            <span style={{ fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                              Lead Quality Score
                            </span>
                            <span style={{ fontSize: '13px', fontWeight: 700, color: getScoreColor(leadScore) }}>
                              {leadScore}/100 — {getScoreLabel(leadScore)}
                            </span>
                          </div>
                          <div style={{ height: '6px', borderRadius: '3px', backgroundColor: '#dcfce7', overflow: 'hidden' }}>
                            <div style={{
                              height: '100%',
                              width: `${leadScore}%`,
                              backgroundColor: getScoreColor(leadScore),
                              borderRadius: '3px',
                              transition: 'width 0.5s ease'
                            }} />
                          </div>
                        </div>

                        {/* Customer details */}
                        <div style={{ padding: '14px 20px', backgroundColor: '#ffffff' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                            {[
                              ['Name', state.fullName || 'N/A'],
                              ['Phone', state.contactPhone || 'N/A'],
                              ['Email', state.contactEmail || 'N/A'],
                              ['Postcode', state.postalCode || 'N/A'],
                              ['Job Type', 'Hedge Trimming'],
                              ['Their Budget', state.userBudget ? formatCurrencyGBP(state.userBudget) : 'N/A'],
                            ].map(([label, val]) => (
                              <div key={label}>
                                <p style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#9ca3af', margin: '0 0 2px' }}>{label}</p>
                                <p style={{ fontSize: '12px', fontWeight: 600, color: '#111827', margin: 0 }}>{val}</p>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Timeline */}
                        <div style={{ padding: '6px 20px 14px', backgroundColor: '#ffffff', borderTop: '1px solid #f0fdf4' }}>
                          <p style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#9ca3af', margin: '0 0 2px' }}>Timeline</p>
                          <p style={{ fontSize: '12px', fontWeight: 600, color: '#111827', margin: 0 }}>{state.projectStartTiming || 'N/A'}</p>
                        </div>

                        {/* SEND TO TREE HEDGE CARE button */}
                        <div style={{ padding: '12px 20px 16px', backgroundColor: '#f0fdf4', borderTop: '1px solid #86efac' }}>
                          <button
                            onClick={() => { }}
                            style={{
                              width: '100%',
                              padding: '13px',
                              backgroundColor: '#15803d',
                              color: '#ffffff',
                              border: 'none',
                              borderRadius: '10px',
                              fontWeight: 800,
                              fontSize: '12px',
                              cursor: 'pointer',
                              letterSpacing: '0.06em',
                              textTransform: 'uppercase',
                              boxShadow: '0 4px 12px rgba(21,128,61,0.35)'
                            }}
                          >
                            SEND TO TREE HEDGE CARE
                          </button>
                        </div>

                      </div>
                    </div>
                  )
                }

                return null
              })}

              {/* Typing indicator */}
              {isProcessing && (
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <div style={{
                    backgroundColor: '#dcfce7',
                    borderRadius: '12px',
                    padding: '10px 14px',
                    display: 'flex',
                    gap: '4px',
                    alignItems: 'center'
                  }}>
                    {[0, 75, 150].map((delay, i) => (
                      <div key={i} style={{
                        width: '7px',
                        height: '7px',
                        borderRadius: '50%',
                        backgroundColor: '#16a34a',
                        animation: `pulse 1.2s ease-in-out ${delay}ms infinite`
                      }} />
                    ))}
                    <span style={{ fontSize: '11px', color: '#15803d', marginLeft: '4px' }}>Thinking...</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Quick Replies */}
            {activeReplies.length > 0 && (
              <div style={{
                padding: '8px 12px',
                backgroundColor: '#f0fdf4',
                borderTop: '1px solid #bbf7d0',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '6px',
                flexShrink: 0
              }}>
                {activeReplies.map((reply, index) => (
                  <button
                    key={index}
                    onClick={() => handleQuickReply(reply.value)}
                    disabled={isProcessing}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: '#ffffff',
                      color: '#15803d',
                      border: '1px solid #86efac',
                      borderRadius: '20px',
                      fontSize: '12px',
                      fontWeight: 500,
                      cursor: 'pointer'
                    }}
                  >
                    {reply.text}
                  </button>
                ))}
              </div>
            )}

            {/* Input Area */}
            <div style={{
              padding: '12px 14px',
              backgroundColor: '#ffffff',
              borderTop: '1px solid #86efac',
              flexShrink: 0
            }}>
              <form onSubmit={handleSend} style={{ display: 'flex', gap: '8px' }}>
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (!isProcessing && input.trim()) {
                        handleSend(e as unknown as React.FormEvent)
                      }
                    }
                  }}
                  placeholder="Type your message..."
                  disabled={isProcessing}
                  style={{
                    flex: 1,
                    padding: '10px 14px',
                    borderRadius: '10px',
                    border: '1px solid #86efac',
                    fontSize: '13px',
                    outline: 'none',
                    backgroundColor: '#f0fdf4',
                    color: '#14532d'
                  }}
                />
                <button
                  type="submit"
                  disabled={isProcessing || !input.trim()}
                  style={{
                    padding: '10px 16px',
                    backgroundColor: '#15803d',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '10px',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: 'pointer',
                    opacity: (isProcessing || !input.trim()) ? 0.5 : 1
                  }}
                >
                  Send
                </button>
              </form>

              {/* Certainty indicator */}
              {state.certaintyLevel > 0 && (
                <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ flex: 1, height: '3px', borderRadius: '2px', overflow: 'hidden', backgroundColor: '#dcfce7' }}>
                    <div style={{
                      height: '100%',
                      width: `${state.certaintyLevel}%`,
                      backgroundColor: '#16a34a',
                      transition: 'width 0.5s ease'
                    }} />
                  </div>
                  <span style={{ fontSize: '10px', color: '#6b7280', whiteSpace: 'nowrap' }}>
                    {state.certaintyLevel}% confident
                  </span>
                </div>
              )}
            </div>

          </div>
        )}

        {/* Toggle bubble */}
        <button
          onClick={() => setIsOpen(o => !o)}
          style={{
            width: '62px',
            height: '62px',
            borderRadius: '50%',
            backgroundColor: '#15803d',
            color: '#ffffff',
            border: 'none',
            cursor: 'pointer',
            fontSize: isOpen ? '22px' : '28px',
            boxShadow: '0 6px 24px rgba(21,128,61,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'transform 0.2s ease'
          }}
        >
          {isOpen ? '✕' : '💬'}
        </button>

      </div>
    </>
  )
}

export default App
