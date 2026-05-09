// src/lib/foodLoggingGuard.ts

export type MealType = "breakfast" | "lunch" | "dinner" | "snack" | "unknown"

export type ParsedFoodItem = {
  originalText: string
  searchTerm: string
  displayName: string
  quantity: number
  unit?: string
  confidence: number
}

export type MealReviewAction = "log_meal" | "edit" | "cancel"

export type MealReviewResponse = {
  type: "meal_review" | "logged" | "error"
  shouldAutoLog: boolean
  needsConfirmation: boolean
  mealType: MealType
  message: string
  items: ParsedFoodItem[]
  actions?: MealReviewAction[]
  missingItems?: string[]
  lowConfidenceItems?: ParsedFoodItem[]
}

const CONFIDENCE_THRESHOLD = 0.85

export function detectMealType(message: string): MealType {
  const text = message.toLowerCase()

  if (text.includes("breakfast")) return "breakfast"
  if (text.includes("lunch")) return "lunch"
  if (text.includes("dinner")) return "dinner"
  if (text.includes("snack")) return "snack"

  return "unknown"
}

export function userExplicitlyRequestedLog(message: string): boolean {
  const text = message.toLowerCase()

  return /\b(log|logged|add|track|save|record)\b/.test(text)
}

export function normalizeFoodSearchTerm(foodText: string): string {
  const text = foodText.toLowerCase().trim()

  if (
    text.includes("egg white") ||
    text.includes("egg whites") ||
    text.includes("whites only")
  ) {
    return "large egg white"
  }

  if (/\begg\b|\beggs\b/.test(text)) {
    return "large whole egg"
  }

  if (text.includes("avocado")) {
    return "hass avocado"
  }

  return foodText.trim()
}

export function extractFoodItems(message: string): string[] {
  let text = message.toLowerCase()

  text = text
    .replace(/\bi had\b/g, "")
    .replace(/\bi ate\b/g, "")
    .replace(/\bfor breakfast\b/g, "")
    .replace(/\bfor lunch\b/g, "")
    .replace(/\bfor dinner\b/g, "")
    .replace(/\bfor snack\b/g, "")
    .replace(/\blog\b/g, "")
    .replace(/\badd\b/g, "")
    .replace(/\btrack\b/g, "")
    .replace(/\bsave\b/g, "")
    .trim()

  return text
    .split(/\s+and\s+|,\s*/)
    .map(item => item.trim())
    .filter(Boolean)
}

export function buildParsedFoodItems(rawItems: string[]): ParsedFoodItem[] {
  return rawItems.map(item => {
    const searchTerm = normalizeFoodSearchTerm(item)

    return {
      originalText: item,
      searchTerm,
      displayName: searchTerm,
      quantity: detectQuantity(item),
      unit: detectUnit(item),
      confidence: 1,
    }
  })
}

function detectQuantity(text: string): number {
  const lower = text.toLowerCase()

  if (lower.includes("half") || lower.includes("1/2")) return 0.5
  if (lower.includes("two")) return 2
  if (lower.includes("three")) return 3
  if (lower.includes("four")) return 4

  const numberMatch = lower.match(/\d+(\.\d+)?/)
  if (numberMatch) return Number(numberMatch[0])

  return 1
}

function detectUnit(text: string): string | undefined {
  const lower = text.toLowerCase()

  if (lower.includes("cup")) return "cup"
  if (lower.includes("oz") || lower.includes("ounce")) return "oz"
  if (lower.includes("gram") || lower.includes("g ")) return "g"
  if (lower.includes("slice")) return "slice"
  if (lower.includes("half")) return "item"

  return undefined
}

export function createMealReview(params: {
  userMessage: string
  detectedItems?: string[]
  matchedItems?: ParsedFoodItem[]
}): MealReviewResponse {
  const mealType = detectMealType(params.userMessage)
  const explicitLog = userExplicitlyRequestedLog(params.userMessage)

  const detectedItems =
    params.detectedItems && params.detectedItems.length > 0
      ? params.detectedItems
      : extractFoodItems(params.userMessage)

  const matchedItems =
    params.matchedItems && params.matchedItems.length > 0
      ? params.matchedItems
      : buildParsedFoodItems(detectedItems)

  const missingItems =
    detectedItems.length > matchedItems.length
      ? detectedItems.slice(matchedItems.length)
      : []

  const lowConfidenceItems = matchedItems.filter(
    item => item.confidence < CONFIDENCE_THRESHOLD
  )

  const hasMissingItems = missingItems.length > 0
  const hasLowConfidence = lowConfidenceItems.length > 0

  const shouldAutoLog =
    explicitLog && !hasMissingItems && !hasLowConfidence

  const needsConfirmation = !shouldAutoLog

  return {
    type: shouldAutoLog ? "logged" : "meal_review",
    shouldAutoLog,
    needsConfirmation,
    mealType,
    message: shouldAutoLog
     ? "Meal is ready to log."
      : "Here’s what I found. Want me to log this?",
    items: matchedItems,
    actions: shouldAutoLog ? undefined : ["log_meal", "edit", "cancel"],
    missingItems,
    lowConfidenceItems,
  }
}

export function formatMealReviewMessage(review: MealReviewResponse): string {
  const mealLabel =
    review.mealType === "unknown"
      ? "Meal"
      : review.mealType.charAt(0).toUpperCase() + review.mealType.slice(1)

  const itemLines = review.items
    .map(item => {
      const qty = item.quantity ? `${item.quantity} ` : ""
      return `- ${qty}${item.displayName}`
    })
    .join("\n")

  return `${mealLabel}\n${itemLines}\n\nWant me to log this?`
}