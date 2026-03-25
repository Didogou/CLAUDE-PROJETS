export const COLORS = {
  background:  '#0d0d0d',
  surface:     '#161618',
  surface2:    '#1e1e22',
  border:      '#2a2a30',
  foreground:  '#ede9df',
  muted:       '#9898b4',
  accent:      '#d4a84c',
  accentDark:  '#8b6914',
  success:     '#52c484',
  danger:      '#e05555',
  overlay:     'rgba(0,0,0,0.75)',
}

export const FONTS = {
  body:    'Georgia',
  ui:      'System',
  heading: 'Georgia',
}

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
}

export const NPC_TYPE_CONFIG = {
  'allié':    { color: '#52c484', icon: '🤝', label: 'Allié' },
  'boss':     { color: '#e05555', icon: '💀', label: 'Boss' },
  'ennemi':   { color: '#e05555', icon: '⚔️',  label: 'Ennemi' },
  'neutre':   { color: '#9898b4', icon: '👤', label: 'Neutre' },
  'marchand': { color: '#d4a84c', icon: '💰', label: 'Marchand' },
} as const

export const PLAYER_QUESTIONS = [
  'On fait quoi ?',
  "T'es avec moi ?",
  "C'est quoi le plan ?",
  "On a le temps ?",
  'Je peux te faire confiance ?',
]
