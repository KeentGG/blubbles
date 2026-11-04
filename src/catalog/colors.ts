// Colour catalog: the twelve named engine colours. Hex values are data only.
export interface Color {
  id: string;
  hex: string;
}

export const COLORS: Color[] = [
  { id: 'ink', hex: '#0a0a0c' },
  { id: 'brown', hex: '#8b5e3c' },
  { id: 'red', hex: '#e8483f' },
  { id: 'orange', hex: '#f08a24' },
  { id: 'amber', hex: '#f0b429' },
  { id: 'green', hex: '#3ecf8e' },
  { id: 'turquoise', hex: '#2fbfa0' },
  { id: 'blue', hex: '#3b93f0' },
  { id: 'purple', hex: '#8b5cf6' },
  { id: 'pink', hex: '#e152b0' },
  { id: 'grey', hex: '#a3a3a3' },
  { id: 'cream', hex: '#f1efe9' },
];

export const COLOR_BY_ID = new Map<string, Color>(COLORS.map((color) => [color.id, color]));
