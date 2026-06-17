export const CLIENT_TYPES = ['New', 'Existing', 'Existing New'] as const

export type ClientType = typeof CLIENT_TYPES[number]

const clientTypeAliases: Record<string, ClientType> = {
  new: 'New',
  newschool: 'New',
  existing: 'Existing',
  exisiting: 'Existing',
  existingschool: 'Existing',
  existingnew: 'Existing New',
  existingnewboth: 'Existing New',
  existingandnew: 'Existing New',
  existingandnewboth: 'Existing New',
  newexisting: 'Existing New',
  newexistingboth: 'Existing New',
  newandexisting: 'Existing New',
  newandexistingboth: 'Existing New',
  both: 'Existing New',
}

const normalizedClientTypes = CLIENT_TYPES.map((clientType) => ({
  clientType,
  normalized: normalizeClientTypeText(clientType),
}))

function normalizeClientTypeText(value: string | null | undefined) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\+/g, 'and')
    .replace(/[^a-z0-9]+/g, '')
}

function damerauLevenshteinDistance(left: string, right: string) {
  const distances = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0))

  for (let i = 0; i <= left.length; i++) distances[i][0] = i
  for (let j = 0; j <= right.length; j++) distances[0][j] = j

  for (let i = 1; i <= left.length; i++) {
    for (let j = 1; j <= right.length; j++) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1
      distances[i][j] = Math.min(
        distances[i - 1][j] + 1,
        distances[i][j - 1] + 1,
        distances[i - 1][j - 1] + substitutionCost,
      )

      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) {
        distances[i][j] = Math.min(distances[i][j], distances[i - 2][j - 2] + 1)
      }
    }
  }

  return distances[left.length][right.length]
}

export function normalizeClientType(value: string | null | undefined) {
  const normalized = normalizeClientTypeText(value)

  if (!normalized) return null
  if (clientTypeAliases[normalized]) return clientTypeAliases[normalized]

  const hasExistingToken = /(^|[^a-z])existing([^a-z]|$)/i.test(String(value || ''))
  const hasNewToken = /(^|[^a-z])new([^a-z]|$)/i.test(String(value || ''))

  if (hasExistingToken && hasNewToken) return 'Existing New'
  if (hasExistingToken) return 'Existing'
  if (hasNewToken) return 'New'

  const matches = normalizedClientTypes
    .map(({ clientType, normalized: candidate }) => ({
      clientType,
      distance: damerauLevenshteinDistance(normalized, candidate),
      threshold: candidate.length <= 3 ? 1 : 2,
    }))
    .filter((match) => match.distance <= match.threshold)
    .sort((a, b) => a.distance - b.distance)

  return matches.length === 1 || matches[0]?.distance < matches[1]?.distance
    ? matches[0]?.clientType || null
    : null
}

export function formatClientType(value: string | null | undefined) {
  return normalizeClientType(value) || value || null
}

export function getAllowedTaskClientTypes(schoolClientType: string | null | undefined) {
  const clientType = normalizeClientType(schoolClientType)

  if (clientType) return new Set<ClientType>([clientType])

  return null
}

export function clientTypesMatch(left: string | null | undefined, right: string | null | undefined) {
  const leftType = normalizeClientType(left)
  const rightType = normalizeClientType(right)

  return Boolean(leftType && rightType && leftType === rightType)
}
