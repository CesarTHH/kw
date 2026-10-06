import { Database, FileText, Mail, Sandwich, Settings, Soup, UtensilsCrossed, Circle, type LucideIcon } from "lucide-react";

const ICONOS: Record<string, LucideIcon> = {
  database: Database,
  utensils: UtensilsCrossed,
  sandwich: Sandwich,
  bowl: Soup,
  pdf: FileText,
  mail: Mail,
  settings: Settings,
};

export function iconoMenu(codigo: string | null): LucideIcon {
  return (codigo && ICONOS[codigo]) || Circle;
}
