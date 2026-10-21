/**
 * Two-letter avatar monogram for a person's name: "Smit Singh" → "SS".
 *
 * Falls back to the app's own initials so an avatar never renders empty when a record has
 * no name yet. Shared by the employee passport and the console's profile screen, which had
 * drifted copies of the same three lines.
 */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || 'SA';
}
