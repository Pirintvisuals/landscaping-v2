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
// Set to true to load the widget in a pre-filled completed state for screenshots.
const DEMO_MODE = true

const DEMO_ESTIMATE: EstimateResult = {
  lowerBound: 5220,
  estimate: 5800,
  upperBound: 6670,
  lineItems: [
    { label: 'Block Paving Materials', amount: 2400, note: '40m² × £60/m²', kind: 'material' },
    { label: 'MOT Type 1 Sub-base', amount: 720, note: '40m² × £18/m²', kind: 'material' },
    { label: 'Sharp Sand Bedding Layer', amount: 280, note: '40m² × £7/m²', kind: 'material' },
    { label: 'Edging Courses & Haunching', amount: 360, note: 'perimeter restraints', kind: 'material' },
    { label: 'Installation Labour', amount: 1350, note: '18hrs × £75.00/hr', kind: 'labor' },
    { label: 'Project Management', amount: 406, note: '7% overhead', kind: 'fee' },
    { label: 'Contingency Reserve', amount: 284, note: '5% contingency allowance', kind: 'fee' }
  ],
  reasoning: `Materials: Quality block paving specified with full MOT Type 1 sub-base.\n\nLogistics: Good driveway access confirmed. No abnormal groundwork anticipated.\n\nIntegrity: 7% Project Management and 5% Contingency included for QC standards.`,
  projectStatus: 'VIP PRIORITY'
}
// ─────────────────────────────────────────────────────────────────────────────

function App() {
  const [state, setState] = useState<ConversationState>(createInitialState())
  const [input, setInput] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [estimate, setEstimate] = useState<EstimateResult | null>(null)
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [_emailSent, setEmailSent] = useState(false)
  const [_sendingEmail, setSendingEmail] = useState(false)

  // Auto-scroll to bottom when new messages appear
  // Auto-scroll to bottom when new messages appear
  useEffect(() => {
    if (messagesEndRef.current) {
      // scrollIntoView is smoother and handles nested scrolling better than scrollTop
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [state.messageHistory])

  // Mount: either load demo completed state or show initial greeting
  useEffect(() => {
    if (DEMO_MODE) {
      const ts = new Date()
      const demoMessages: ChatMessage[] = [
        { id: 'dm-1', role: 'agent', content: "What kind of work are you looking to get done?", timestamp: ts },
        { id: 'dm-2', role: 'user', content: "Looking to get a resin bound driveway done", timestamp: ts },
        { id: 'dm-3', role: 'agent', content: "Great choice. Resin bound is low maintenance and looks smart. Roughly how big is the driveway? Dimensions are fine.", timestamp: ts },
        { id: 'dm-4', role: 'user', content: "About 8 metres by 5 metres, so 40 square metres", timestamp: ts },
        { id: 'dm-5', role: 'agent', content: "40m² noted. Premium finish or standard?", timestamp: ts },
        { id: 'dm-6', role: 'user', content: "Premium please", timestamp: ts },
        { id: 'dm-7', role: 'agent', content: "Is there easy vehicle access to the driveway area?", timestamp: ts },
        { id: 'dm-8', role: 'user', content: "Yes, open fronted", timestamp: ts },
        { id: 'dm-9', role: 'agent', content: "Room to park a van and unload materials nearby?", timestamp: ts },
        { id: 'dm-10', role: 'user', content: "Yes plenty of space", timestamp: ts },
        { id: 'dm-11', role: 'agent', content: "Is the ground flat or is there any slope?", timestamp: ts },
        { id: 'dm-12', role: 'user', content: "Flat", timestamp: ts },
        { id: 'dm-13', role: 'agent', content: "Anything on the driveway currently that needs breaking up and removing?", timestamp: ts },
        { id: 'dm-14', role: 'user', content: "No, just gravel at the moment", timestamp: ts },
        { id: 'dm-15', role: 'agent', content: "What's your full name?", timestamp: ts },
        { id: 'dm-16', role: 'user', content: "James Thornton", timestamp: ts },
        { id: 'dm-17', role: 'agent', content: "Thanks James. Best phone number?", timestamp: ts },
        { id: 'dm-18', role: 'user', content: "07512 334 891", timestamp: ts },
        { id: 'dm-19', role: 'agent', content: "And your email address?", timestamp: ts },
        { id: 'dm-20', role: 'user', content: "j.thornton@gmail.com", timestamp: ts },
        { id: 'dm-21', role: 'agent', content: "Your postcode?", timestamp: ts },
        { id: 'dm-22', role: 'user', content: "BD23 3LX", timestamp: ts },
        { id: 'dm-23', role: 'agent', content: "What's your rough budget for this?", timestamp: ts },
        { id: 'dm-24', role: 'user', content: "Around £4,000", timestamp: ts },
        { id: 'dm-25', role: 'agent', content: "When are you looking to start?", timestamp: ts },
        { id: 'dm-26', role: 'user', content: "Next month if possible", timestamp: ts },
        { id: 'dm-27', role: 'agent', content: "Thanks James, putting your estimate together now...", timestamp: ts },
        { id: 'dm-28', role: 'estimate', content: '', timestamp: ts }
      ]
      setState(prev => ({
        ...prev,
        messageHistory: demoMessages,
        service: 'softscaping',
        area_m2: 18,
        length_m: 6,
        width_m: 3,
        materialTier: 'premium',
        hasExcavatorAccess: true,
        hasDrivewayForSkip: true,
        slopeLevel: 'flat',
        existingDemolition: false,
        fullName: 'Daniel Myers',
        contactPhone: '07512 334 891',
        contactEmail: 'd.myers@hotmail.co.uk',
        postalCode: 'FY8 3LG',
        userBudget: 5200,
        projectStartTiming: 'Next 2-3 months'
      }))
      setEstimate(DEMO_ESTIMATE)
    } else {
      const greeting: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'agent',
        content: "Hi! I'm your landscaping assistant. What kind of outdoor transformation are you thinking about?",
        timestamp: new Date()
      }
      setState(prev => ({
        ...prev,
        messageHistory: [greeting]
      }))
    }
  }, [])

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
        // New fields
        projectStartTiming: state.projectStartTiming || 'Not specified',
        groundSoilType: state.groundSoilType || 'Not specified',
        hasExcavatorAccess: state.hasExcavatorAccess // useful for 'ACCESS'
      }

      // 1. Zod Validation
      // We validate the contact info part mostly, as other parts are derived from state logic
      // But let's check basic sanity
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

      // 2. Sanitization (though we send JSON, it's good practice to sanitize values if they are ever echoed back)
      const leadData = {
        ...rawLeadData,
        fullName: DOMPurify.sanitize(rawLeadData.fullName),
        contactPhone: DOMPurify.sanitize(rawLeadData.contactPhone),
        contactEmail: DOMPurify.sanitize(rawLeadData.contactEmail),
        projectStartTiming: DOMPurify.sanitize(rawLeadData.projectStartTiming),
        groundSoilType: DOMPurify.sanitize(rawLeadData.groundSoilType)
        // numeric fields don't need sanitization
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
          content: '✅ **Request Received.** I have submitted your request to **Secure Your Project Slot**.',
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

      // MOCK FALLBACK for Localhost/Dev without backend
      console.log('⚡ Dev Mode: Simulating successful email send')
      setEmailSent(true)
      const successMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'agent',
        content: '✅ **Request Received.** I have submitted your request to **Secure Your Project Slot**.',
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
    if (!sanitizedInput) return // Prevent empty after sanitization

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: sanitizedInput,
      timestamp: new Date()
    }

    // Add user message to state immediately
    setState(prev => ({
      ...prev,
      messageHistory: [...prev.messageHistory, userMessage]
    }))

    setInput('')
    setIsProcessing(true)

    try {
      let extracted: ExtractedInfo = {}

      // FORCE API USAGE: We always route through Gemini (2.5 Flash Lite / 1.5 Flash)
      // for "Natural Language Processor" capabilities.
      try {
        // console.log('🌐 Routing message to Gemini Natural Language Processor...')
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

          // If the API returns an explicit agent response, we'll favor that.
          if (data.agentResponse) {
            extracted.agentResponse = data.agentResponse
          }
          console.log('✅ Gemini extraction complete', extracted)
        } else {
          throw new Error('API not available')
        }
      } catch (apiError) {
        console.error('⚠️ API unavailable or failed:', apiError)
        // Fallback: If API fails, we might end up with empty extraction, 
        // which will trigger the "Sorry, I had trouble" or generic fallback flow.
      }

      // Update state with extracted information
      // We detect the CURRENT field *before* the update to see if we satisfied the pending question.
      const currentField = detectCurrentField(state)
      const updatedState = updateStateWithExtraction(state, extracted, currentField)

      // RETRY DETECTION: Check if extraction was successful FOR THE CURRENT FIELD
      let stateWithRetry = updatedState
      // currentField is already defined above
      const relevantFieldExtracted = isRelevantFieldExtracted(currentField, extracted, state, updatedState)

      // FORCE ACCEPT POSTCODE: If we asked for postcode, and user typed something, accept it.
      if (currentField === 'postalCode' && !relevantFieldExtracted && sanitizedInput.length > 1) {
        // Manually inject it
        stateWithRetry.postalCode = sanitizedInput.toUpperCase()
        // Clear retry count effectively
        stateWithRetry = resetRetryCount(stateWithRetry)
      } else if (!relevantFieldExtracted) {
        // Current field wasn't extracted - user response not understood for this question
        stateWithRetry = incrementRetryCount(updatedState, currentField)

        // Show fallback quick replies if retry count >= 1
        if (stateWithRetry.showQuickReplies) {
          const fallbackReplies = getFallbackQuickReplies(currentField, stateWithRetry)
          setQuickReplies(fallbackReplies)
        }
      } else {
        // Successfully extracted relevant field - reset retry
        stateWithRetry = resetRetryCount(updatedState)
        setQuickReplies([])
      }

      // Generate acknowledgment
      const ack = generateAcknowledgment(stateWithRetry, extracted)

      // Get next question  
      const nextQ = getNextQuestion(stateWithRetry)

      // Build agent response
      let agentContent = ''
      const hasAIResponse = !!extracted.agentResponse

      // 1. USE AI RESPONSE IF AVAILABLE (Smartest)
      if (hasAIResponse) {
        agentContent = extracted.agentResponse!
      }
      // 2. FALLBACK TO LOCAL LOGIC (If API didn't return a reply)
      else {
        if (ack) agentContent += ack + ' '
      }

      // Check if ready for estimate
      if (isReadyForEstimate(stateWithRetry) && !nextQ) {
        const serviceName = stateWithRetry.service || 'landscaping'
        agentContent += `I've gathered everything. Because it's currently peak season, we are actually only taking on 3 more ${serviceName} projects before the summer starts to ensure we maintain our high standards. I'll send this over to our senior surveyor right now.`

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

        // Generate estimate
        setTimeout(() => {
          generateEstimate(stateWithRetry)
        }, 1000)

      } else if (nextQ) {
        // Add retry message if showing quick replies
        if (stateWithRetry.showQuickReplies) {
          agentContent = "Apologies, I didn't catch that. Could you please select an option below or clarify?"
        } else if (!hasAIResponse) {
          // Only append local nextQ if AI didn't already provide a response
          agentContent += nextQ
        }
        // If AI already responded, use that alone (no double question)

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
        // Fallback
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
    // Simulate user typing the quick reply value
    setInput(value)
    // Trigger form submission programmatically
    handleSend({ preventDefault: () => { } } as React.FormEvent)
  }

  const generateEstimate = (conversationState: ConversationState) => {
    let inputs: ProjectInputs | undefined;
    try {
      // Build ProjectInputs from conversation state
      inputs = {
        service: conversationState.service || 'hardscaping',
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

      // Validate inputs using Zod to ensure positive numbers and correct types
      const safeInputs = estimatorSchema.parse(inputs)
      // ... same as before
      const result = calculateUKEstimate(safeInputs as ProjectInputs)
      setEstimate(result)

      const estimateMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'estimate',
        content: '', // Content will be rendered separately
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
        content: "I'm having trouble calculating that estimate. Could you verify the project details? (Error code: invalid_inputs)",
        timestamp: new Date()
      }

      setState(prev => ({
        ...prev,
        messageHistory: [...prev.messageHistory, errorMessage],
        awaitingEstimate: false // Allow retry
      }))
    }
  }

  const activeReplies = state.showQuickReplies ? quickReplies : getQuickReplies(state)

  return (
    <div className="flex min-h-screen flex-col" style={{ backgroundColor: '#111111' }}>

      {/* Header */}
      <header className="border-b p-4" style={{ backgroundColor: '#1a1a1a', borderColor: '#2d7a2d' }}>
        <div className="mx-auto max-w-4xl">
          <h1 className="text-xl font-bold" style={{ color: '#2d7a2d' }}>
            Dc landscaping Lytham
          </h1>
          <p className="mt-1 text-sm" style={{ color: '#7ab8d0' }}>
            Landscaping specialists | Driveways | Garden Design | Lytham St Annes
          </p>
        </div>
      </header>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4" ref={messagesEndRef}>
        <div className="mx-auto max-w-4xl space-y-4">
          {state.messageHistory.map((message) => {
            if (message.role === 'agent') {
              // Check if this is a scarcity alert message
              const isScarcityAlert = message.content.includes('⚠️') && message.content.includes('System Note')

              return (
                <div key={message.id} className="flex justify-start">
                  <div
                    className="rounded-2xl p-4 max-w-[80%] shadow-sm"
                    style={{
                      backgroundColor: isScarcityAlert ? '#FFF4E5' : '#FFFFFF',
                      color: isScarcityAlert ? '#B45309' : '#394f20',
                      border: isScarcityAlert ? '2px solid #F59E0B' : '1px solid #125878',
                      boxShadow: isScarcityAlert ? '0 0 10px rgba(245, 158, 11, 0.2)' : '0 2px 5px rgba(0,0,0,0.05)'
                    }}
                  >
                    <p
                      className="text-sm leading-relaxed whitespace-pre-wrap"
                      dangerouslySetInnerHTML={{
                        __html: DOMPurify.sanitize(message.content.replace(
                          /\[([^\]]+)\]\(([^\)]+)\)/g,
                          '<a href="$2" target="_blank" rel="noopener noreferrer" style="color: #125878; text-decoration: underline; font-weight: bold;">$1</a>'
                        ))
                      }}
                    />
                  </div>
                </div>
              )
            }

            if (message.role === 'user') {
              return (
                <div key={message.id} className="flex justify-end">
                  <div
                    className="rounded-2xl p-4 max-w-[80%] shadow-sm"
                    style={{
                      backgroundColor: '#125878',
                      color: '#FFFFFF',
                      border: 'none'
                    }}
                  >
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">
                      {message.content}
                    </p>
                  </div>
                </div>
              )
            }

            if (message.role === 'estimate' && estimate) {

              return (
                <div key={message.id} className="my-4">
                  <div
                    className="rounded-2xl overflow-hidden"
                    style={{
                      backgroundColor: '#2d7a2d',
                      boxShadow: '0 25px 70px rgba(0,0,0,0.35), 0 4px 20px rgba(0,0,0,0.18)',
                      border: '1px solid rgba(0,0,0,0.12)',
                    }}
                  >

                    {/* 1. New Enquiry bar + logo */}
                    <div>
                      <div
                        className="px-6 py-2.5 flex items-center justify-between"
                        style={{ backgroundColor: '#111111' }}
                      >
                        <span className="text-sm font-black tracking-wide uppercase" style={{ color: '#ffffff' }}>New Enquiry</span>
                        <span className="text-[11px] font-medium" style={{ color: '#ffffff', opacity: 0.6 }}>
                          Today at {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true })}
                        </span>
                      </div>
                      <div className="flex items-center justify-center gap-4 px-6 py-7" style={{ borderBottom: '2px solid rgba(0,0,0,0.2)' }}>
                        <svg viewBox="0 0 24 24" style={{ width: '20px', height: '20px', opacity: 0.4, flexShrink: 0 }} fill="#111111"><path d="M17 8C8 10 5.9 16.17 3.82 19H5.71C6.39 17.73 7.29 16.54 8.5 15.59C12 13 16 11 21 12C21 12 21 8.5 17 8Z"/></svg>
                        <img src="/dc-landscaping-logo.png" alt="Dc landscaping Lytham" style={{ height: '140px', width: 'auto', display: 'block' }} />
                        <svg viewBox="0 0 24 24" style={{ width: '20px', height: '20px', opacity: 0.4, flexShrink: 0, transform: 'scaleX(-1)' }} fill="#111111"><path d="M17 8C8 10 5.9 16.17 3.82 19H5.71C6.39 17.73 7.29 16.54 8.5 15.59C12 13 16 11 21 12C21 12 21 8.5 17 8Z"/></svg>
                      </div>
                    </div>

                    {/* 2. Hero cost */}
                    <div className="px-6 pt-8 pb-6 text-center">
                      <p className="text-[10px] uppercase tracking-[0.2em] font-semibold mb-2" style={{ color: 'rgba(0,0,0,0.45)' }}>
                        Your next enquiry could look like this
                      </p>
                      <p className="font-black leading-none" style={{ fontSize: '3.75rem', color: '#111111', letterSpacing: '-3px' }}>
                        {formatCurrencyGBP(estimate.estimate)}
                      </p>
                      <div className="flex items-center justify-center gap-3 mt-3">
                        <span className="text-xs tabular-nums" style={{ color: 'rgba(0,0,0,0.4)' }}>{formatCurrencyGBP(estimate.lowerBound)}</span>
                        <div className="relative flex-1 max-w-[80px] h-1 rounded-full" style={{ backgroundColor: 'rgba(0,0,0,0.15)' }}>
                          <div className="absolute inset-y-0 left-1/4 right-1/4 rounded-full" style={{ backgroundColor: '#111111' }} />
                        </div>
                        <span className="text-xs tabular-nums" style={{ color: 'rgba(0,0,0,0.4)' }}>{formatCurrencyGBP(estimate.upperBound)}</span>
                      </div>
                      <p className="text-[10px] mt-1" style={{ color: 'rgba(0,0,0,0.3)' }}>indicative range</p>

                      {/* VIP badge */}
                      <div className="mt-5 flex flex-col items-center gap-1.5">
                        <span className="inline-block px-4 py-1.5 rounded-full text-xs font-bold tracking-wide" style={{ backgroundColor: '#111111', color: '#ffffff' }}>
                          {estimate.projectStatus}
                        </span>
                        <p className="text-[11px]" style={{ color: 'rgba(0,0,0,0.5)' }}>Budget matches estimated cost</p>
                      </div>
                    </div>

                    {/* Divider */}
                    <div className="mx-6" style={{ borderTop: '1px solid rgba(0,0,0,0.12)' }} />

                    {/* 5. Customer details */}
                    <div className="px-6 py-5">
                      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                        <div>
                          <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'rgba(0,0,0,0.5)' }}>Name</p>
                          <p className="text-sm font-semibold" style={{ color: '#111111' }}>Daniel</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'rgba(0,0,0,0.5)' }}>Phone</p>
                          <p className="text-sm font-semibold" style={{ color: '#111111' }}>{state.contactPhone || 'N/A'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'rgba(0,0,0,0.5)' }}>Email</p>
                          <p className="text-sm font-semibold" style={{ color: '#111111' }}>{state.contactEmail || 'N/A'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'rgba(0,0,0,0.5)' }}>Postcode</p>
                          <p className="text-sm font-semibold" style={{ color: '#111111' }}>FY8 3LG</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'rgba(0,0,0,0.5)' }}>Job Type</p>
                          <p className="text-sm font-semibold" style={{ color: '#111111' }}>Block Paved Driveway</p>
                        </div>
                      </div>
                    </div>

                    {/* Divider */}
                    <div className="mx-6" style={{ borderTop: '1px solid rgba(0,0,0,0.12)' }} />

                    {/* 6. Budget + timeline */}
                    <div className="px-6 py-5">
                      <div className="grid grid-cols-2 gap-x-6">
                        <div>
                          <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'rgba(0,0,0,0.5)' }}>Their budget</p>
                          <p className="text-sm font-semibold" style={{ color: '#111111' }}>{state.userBudget ? formatCurrencyGBP(state.userBudget) : 'N/A'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'rgba(0,0,0,0.5)' }}>Timeline</p>
                          <p className="text-sm font-semibold" style={{ color: '#111111' }}>{state.projectStartTiming || 'N/A'}</p>
                        </div>
                      </div>
                    </div>

                  </div>
                </div>
              )
            }

            return null
          })}

          {/* Typing indicator */}
          {isProcessing && (
            <div className="flex justify-start">
              <div
                className="rounded-2xl px-5 py-3"
                style={{
                  backgroundColor: '#1a3d5c',
                  border: '1px solid #1a5470'
                }}
              >
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: '#f6f4f5' }}></div>
                    <div className="w-2 h-2 rounded-full animate-pulse delay-75" style={{ backgroundColor: '#f6f4f5' }}></div>
                    <div className="w-2 h-2 rounded-full animate-pulse delay-150" style={{ backgroundColor: '#f6f4f5' }}></div>
                  </div>
                  <span className="text-xs" style={{ color: '#7ab8d0' }}>
                    Thinking...
                  </span>
                </div>
              </div>
            </div>
          )}


        </div>
      </div>

      {/* Input Area */}
      <div
        className="sticky bottom-0 border-t p-4"
        style={{
          backgroundColor: '#1a3d5c',
          borderColor: '#1a5470'
        }}
      >
        <div className="mx-auto max-w-4xl">
          <form onSubmit={handleSend} className="flex gap-3">
            <input
              ref={inputRef}
              type="text"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (!isProcessing && input.trim()) {
                    handleSend(e as unknown as React.FormEvent)
                  }
                }
              }}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your message..."
              disabled={isProcessing}
              className="flex-1 rounded-xl px-5 py-3 text-sm focus:outline-none focus:ring-2"
              style={{
                backgroundColor: '#ffffff',
                color: '#DAF1DE',
                border: '1px solid #1a5470'
              }}
            />
            <button
              type="submit"
              disabled={isProcessing || !input.trim()}
              className="rounded-xl px-8 py-3 font-medium transition disabled:opacity-50"
              style={{
                backgroundColor: '#f6f4f5',
                color: '#031904'
              }}
            >
              Send
            </button>
          </form>

          {/* Quick Reply Buttons - shown immediately for certain fields, or on retry for others */}
          {activeReplies.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {activeReplies.map((reply, index) => (
                <button
                  key={index}
                  onClick={() => handleQuickReply(reply.value)}
                  disabled={isProcessing}
                  className="quick-reply-btn rounded-lg px-4 py-2 text-sm font-medium transition-all hover:scale-105 disabled:opacity-50"
                  style={{
                    backgroundColor: '#FFFFFF',
                    color: '#125878',
                    border: '1px solid #125878',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                  }}
                >
                  {reply.text}
                </button>
              ))}
            </div>
          )}

          {/* Certainty indicator */}
          {state.certaintyLevel > 0 && (
            <div className="mt-3 flex items-center gap-2">
              <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ backgroundColor: '#1a5470' }}>
                <div
                  className="h-full transition-all duration-500"
                  style={{
                    width: `${state.certaintyLevel}%`,
                    backgroundColor: state.certaintyLevel >= 85 ? '#f6f4f5' : '#f6f4f5'
                  }}
                />
              </div>
              <span className="text-xs whitespace-nowrap" style={{ color: '#7ab8d0' }}>
                {state.certaintyLevel}% confident
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
