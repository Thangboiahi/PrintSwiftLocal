import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Ambulance,
  Award,
  BadgeCheck,
  Banknote,
  Bed,
  Bell,
  Bike,
  BookOpen,
  Box,
  Briefcase,
  Building,
  Building2,
  Bus,
  Cake,
  Calendar,
  Camera,
  Car,
  CarTaxiFront,
  CheckCircle2,
  ChefHat,
  Church,
  Clock,
  Coffee,
  Compass,
  CreditCard,
  Crown,
  Database,
  Droplets,
  FileCheck2,
  FileText,
  Flame,
  Flower2,
  FolderTree,
  Fuel,
  Gift,
  Globe,
  GraduationCap,
  Hammer,
  HardHat,
  Heart,
  HeartPulse,
  HelpCircle,
  Home,
  Hospital,
  Hotel,
  Image as ImageIcon,
  Key,
  Landmark,
  Laptop,
  Layers,
  Leaf,
  Lock,
  Mail,
  Map as MapIcon,
  MapPin,
  Megaphone,
  MessageSquare,
  Mic,
  Milk,
  Mountain,
  Music,
  Navigation,
  Newspaper,
  Package,
  Palette,
  Percent,
  Phone,
  Pill,
  Pizza,
  Printer,
  Radio,
  Receipt,
  Scale,
  School,
  Scissors,
  Settings,
  Shield,
  ShieldAlert,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Sliders,
  Smartphone,
  Sparkles,
  Stethoscope,
  Store,
  Sun,
  Tag,
  Ticket,
  Trees,
  Truck,
  Tv,
  Users,
  Utensils,
  UtensilsCrossed,
  Video,
  Wallet,
  Warehouse,
  Wifi,
  Wrench,
  Zap,
} from 'lucide-react';

export type IconCategoryId =
  | 'commerce'
  | 'food'
  | 'logistics'
  | 'real_estate'
  | 'health_civic'
  | 'media_bulletin'
  | 'admin';

export interface IconCategoryMeta {
  id: IconCategoryId;
  label: string;
}

export interface IconRegistryItem {
  key: string;
  label: string;
  category: IconCategoryId;
  keywords: string[];
  icon: LucideIcon;
}

export const ICON_CATEGORIES: IconCategoryMeta[] = [
  { id: 'commerce', label: 'Commerce' },
  { id: 'food', label: 'Food' },
  { id: 'logistics', label: 'Logistics & Fleet' },
  { id: 'real_estate', label: 'Real Estate' },
  { id: 'health_civic', label: 'Health & Civic' },
  { id: 'media_bulletin', label: 'Media & Bulletin' },
  { id: 'admin', label: 'Admin' },
];

export const ACCENT_COLOR_SWATCHES: Array<{ hex: string; label: string }> = [
  { hex: '#2563EB', label: 'Cobalt' },
  { hex: '#0284C7', label: 'Sky' },
  { hex: '#0891B2', label: 'Teal' },
  { hex: '#059669', label: 'Emerald' },
  { hex: '#16A34A', label: 'Green' },
  { hex: '#D97706', label: 'Amber' },
  { hex: '#EA580C', label: 'Orange' },
  { hex: '#DC2626', label: 'Crimson' },
  { hex: '#E11D48', label: 'Rose' },
  { hex: '#7C3AED', label: 'Violet' },
  { hex: '#4F46E5', label: 'Indigo' },
  { hex: '#475569', label: 'Slate' },
];

export const ICON_REGISTRY: IconRegistryItem[] = [
  // COMMERCE (18)
  { key: 'store', label: 'Store', category: 'commerce', keywords: ['shop', 'retail', 'bazaar', 'market'], icon: Store },
  { key: 'shopping-bag', label: 'Shopping Bag', category: 'commerce', keywords: ['boutique', 'fashion', 'handloom', 'goods'], icon: ShoppingBag },
  { key: 'shopping-cart', label: 'Shopping Cart', category: 'commerce', keywords: ['grocery', 'mart', 'supermarket'], icon: ShoppingCart },
  { key: 'tag', label: 'Tag', category: 'commerce', keywords: ['price', 'label', 'category', 'deal'], icon: Tag },
  { key: 'smartphone', label: 'Smartphone', category: 'commerce', keywords: ['mobile', 'phone', 'repair', 'electronics'], icon: Smartphone },
  { key: 'laptop', label: 'Laptop', category: 'commerce', keywords: ['computer', 'cyber', 'it', 'tech'], icon: Laptop },
  { key: 'printer', label: 'Printer', category: 'commerce', keywords: ['xerox', 'dtp', 'stationery', 'print'], icon: Printer },
  { key: 'shirt', label: 'Apparel', category: 'commerce', keywords: ['clothes', 'tailor', 'puan', 'textile'], icon: Shirt },
  { key: 'scissors', label: 'Salon & Tailor', category: 'commerce', keywords: ['barber', 'beauty', 'parlour', 'stitching'], icon: Scissors },
  { key: 'wrench', label: 'Repairs & Tools', category: 'commerce', keywords: ['mechanic', 'hardware', 'service', 'plumber'], icon: Wrench },
  { key: 'hammer', label: 'Hardware', category: 'commerce', keywords: ['carpentry', 'building', 'tools', 'timber'], icon: Hammer },
  { key: 'gift', label: 'Gifts', category: 'commerce', keywords: ['present', 'craft', 'souvenir', 'florist'], icon: Gift },
  { key: 'percent', label: 'Offers & Deals', category: 'commerce', keywords: ['discount', 'sale', 'promo', 'coupon'], icon: Percent },
  { key: 'wallet', label: 'Wallet', category: 'commerce', keywords: ['cash', 'finance', 'upi', 'banking'], icon: Wallet },
  { key: 'banknote', label: 'Currency', category: 'commerce', keywords: ['money', 'atm', 'loan', 'inr'], icon: Banknote },
  { key: 'credit-card', label: 'Card Payments', category: 'commerce', keywords: ['pos', 'billing', 'checkout', 'payment'], icon: CreditCard },
  { key: 'briefcase', label: 'Jobs & Services', category: 'commerce', keywords: ['business', 'office', 'consultancy', 'agency'], icon: Briefcase },
  { key: 'palette', label: 'Art & Craft', category: 'commerce', keywords: ['design', 'paint', 'studio', 'decor'], icon: Palette },

  // FOOD (12)
  { key: 'utensils', label: 'Restaurant', category: 'food', keywords: ['dining', 'hotel', 'eatery', 'thali'], icon: Utensils },
  { key: 'utensils-crossed', label: 'Fine Dining', category: 'food', keywords: ['food', 'catering', 'banquet', 'kitchen'], icon: UtensilsCrossed },
  { key: 'coffee', label: 'Cafe & Tea', category: 'food', keywords: ['tea', 'bakery', 'snacks', 'hangout'], icon: Coffee },
  { key: 'chef-hat', label: 'Home Chef', category: 'food', keywords: ['tiffin', 'cloud kitchen', 'cook', 'catering'], icon: ChefHat },
  { key: 'cake', label: 'Bakery & Sweets', category: 'food', keywords: ['pastry', 'birthday', 'dessert', 'mithai'], icon: Cake },
  { key: 'pizza', label: 'Fast Food', category: 'food', keywords: ['momo', 'noodles', 'burger', 'street food'], icon: Pizza },
  { key: 'milk', label: 'Dairy & Fresh', category: 'food', keywords: ['milk', 'paneer', 'beverages', 'fresh'], icon: Milk },
  { key: 'leaf', label: 'Pure Veg & Organic', category: 'food', keywords: ['vegetables', 'produce', 'organic', 'farm'], icon: Leaf },
  { key: 'flame', label: 'LPG & Grill', category: 'food', keywords: ['bbq', 'smoked', 'gas', 'hot'], icon: Flame },
  { key: 'droplets', label: 'Drinking Water', category: 'food', keywords: ['water', 'jar', 'ro', 'supply'], icon: Droplets },
  { key: 'flower-2', label: 'Florist & Nursery', category: 'food', keywords: ['garden', 'plants', 'seeds', 'organic'], icon: Flower2 },
  { key: 'sparkles', label: 'Featured & Specials', category: 'food', keywords: ['popular', 'new', 'curated', 'trending'], icon: Sparkles },

  // LOGISTICS & FLEET (14)
  { key: 'truck', label: 'Pick N Drop Truck', category: 'logistics', keywords: ['delivery', 'cargo', 'freight', 'pickup'], icon: Truck },
  { key: 'car', label: 'Car & SUV', category: 'logistics', keywords: ['rental', 'cab', 'bolero', 'travel'], icon: Car },
  { key: 'car-taxi-front', label: 'Taxi & Auto', category: 'logistics', keywords: ['auto', 'cab', 'ride', 'passenger'], icon: CarTaxiFront },
  { key: 'bike', label: 'Two-Wheeler', category: 'logistics', keywords: ['scooty', 'motorcycle', 'rickshaw', 'express'], icon: Bike },
  { key: 'bus', label: 'Bus & Sumo', category: 'logistics', keywords: ['wingers', 'imphal', 'transit', 'shuttle'], icon: Bus },
  { key: 'package', label: 'Parcel', category: 'logistics', keywords: ['courier', 'box', 'shipment', 'dispatch'], icon: Package },
  { key: 'box', label: 'Cargo Box', category: 'logistics', keywords: ['packing', 'moving', 'goods', 'storage'], icon: Box },
  { key: 'warehouse', label: 'Hub & Warehouse', category: 'logistics', keywords: ['depot', 'godown', 'fulfillment', 'dispatch'], icon: Warehouse },
  { key: 'navigation', label: 'Live Route', category: 'logistics', keywords: ['gps', 'directions', 'tracking', 'nav'], icon: Navigation },
  { key: 'map-pin', label: 'Locality Pin', category: 'logistics', keywords: ['location', 'address', 'lamka', 'place'], icon: MapPin },
  { key: 'map', label: 'District Map', category: 'logistics', keywords: ['explore', 'area', 'zone', 'polygon'], icon: MapIcon },
  { key: 'compass', label: 'Explore', category: 'logistics', keywords: ['discover', 'nearby', 'travel', 'guide'], icon: Compass },
  { key: 'fuel', label: 'Fuel & Petrol', category: 'logistics', keywords: ['petrol', 'diesel', 'pump', 'ev'], icon: Fuel },
  { key: 'clock', label: 'Express & 24x7', category: 'logistics', keywords: ['hours', 'fast', 'schedule', 'timing'], icon: Clock },

  // REAL ESTATE (12)
  { key: 'home', label: 'Home & House', category: 'real_estate', keywords: ['rent', 'sale', 'residential', 'house'], icon: Home },
  { key: 'building', label: 'Commercial Space', category: 'real_estate', keywords: ['shop space', 'complex', 'office', 'floor'], icon: Building },
  { key: 'building-2', label: 'Apartments', category: 'real_estate', keywords: ['flat', 'building', 'towers', 'urban'], icon: Building2 },
  { key: 'hotel', label: 'Hotels & Lodges', category: 'real_estate', keywords: ['stay', 'guesthouse', 'inn', 'homestay'], icon: Hotel },
  { key: 'bed', label: 'PG & Hostels', category: 'real_estate', keywords: ['room', 'boarding', 'hostel', 'stay'], icon: Bed },
  { key: 'key', label: 'Property Lease', category: 'real_estate', keywords: ['rental', 'broker', 'handover', 'lease'], icon: Key },
  { key: 'trees', label: 'Land & Plots', category: 'real_estate', keywords: ['plot', 'farm', 'land', 'estate'], icon: Trees },
  { key: 'mountain', label: 'Hill Plots & Tourism', category: 'real_estate', keywords: ['resort', 'hills', 'scenic', 'churachandpur'], icon: Mountain },
  { key: 'hard-hat', label: 'Construction', category: 'real_estate', keywords: ['contractor', 'cement', 'architect', 'civil'], icon: HardHat },
  { key: 'zap', label: 'Power & Solar', category: 'real_estate', keywords: ['electrician', 'inverter', 'solar', 'utility'], icon: Zap },
  { key: 'wifi', label: 'Broadband & Fiber', category: 'real_estate', keywords: ['internet', 'isp', 'network', 'fiber'], icon: Wifi },
  { key: 'sun', label: 'Daylight & Energy', category: 'real_estate', keywords: ['solar', 'weather', 'outdoor', 'morning'], icon: Sun },

  // HEALTH & CIVIC (16)
  { key: 'hospital', label: 'Hospital', category: 'health_civic', keywords: ['clinic', 'medical', 'district hospital', 'emergency'], icon: Hospital },
  { key: 'stethoscope', label: 'Doctor & Clinic', category: 'health_civic', keywords: ['physician', 'dental', 'checkup', 'opd'], icon: Stethoscope },
  { key: 'pill', label: 'Pharmacy', category: 'health_civic', keywords: ['medicine', 'chemist', 'drugstore', 'medical'], icon: Pill },
  { key: 'ambulance', label: 'Ambulance & SOS', category: 'health_civic', keywords: ['emergency', 'rescue', 'helpline', '108'], icon: Ambulance },
  { key: 'heart-pulse', label: 'Diagnostics & Lab', category: 'health_civic', keywords: ['pathology', 'blood', 'health', 'fitness'], icon: HeartPulse },
  { key: 'heart', label: 'NGO & Welfare', category: 'health_civic', keywords: ['charity', 'blood bank', 'care', 'community'], icon: Heart },
  { key: 'landmark', label: 'Civic & Govt', category: 'health_civic', keywords: ['dc office', 'municipal', 'public', 'bank'], icon: Landmark },
  { key: 'school', label: 'School', category: 'health_civic', keywords: ['academy', 'tuition', 'education', 'campus'], icon: School },
  { key: 'graduation-cap', label: 'College & Coaching', category: 'health_civic', keywords: ['university', 'institute', 'exam', 'training'], icon: GraduationCap },
  { key: 'book-open', label: 'Library & Books', category: 'health_civic', keywords: ['bookstore', 'study', 'stationery', 'reading'], icon: BookOpen },
  { key: 'church', label: 'Faith & Community', category: 'health_civic', keywords: ['church', 'fellowship', 'worship', 'hall'], icon: Church },
  { key: 'scale', label: 'Legal & Notary', category: 'health_civic', keywords: ['advocate', 'court', 'law', 'affidavit'], icon: Scale },
  { key: 'phone', label: 'Helpline', category: 'health_civic', keywords: ['contact', 'call', 'support', 'hotline'], icon: Phone },
  { key: 'shield-alert', label: 'Police & Safety', category: 'health_civic', keywords: ['fire', 'police', 'alert', 'safety'], icon: ShieldAlert },
  { key: 'help-circle', label: 'Help Desk', category: 'health_civic', keywords: ['faq', 'info', 'guidance', 'support'], icon: HelpCircle },
  { key: 'globe', label: 'Public Portal', category: 'health_civic', keywords: ['website', 'district', 'online', 'language'], icon: Globe },

  // MEDIA & BULLETIN (14)
  { key: 'newspaper', label: 'District Bulletin', category: 'media_bulletin', keywords: ['news', 'notice', 'classified', 'press'], icon: Newspaper },
  { key: 'megaphone', label: 'Announcements', category: 'media_bulletin', keywords: ['broadcast', 'promo', 'alert', 'campaign'], icon: Megaphone },
  { key: 'calendar', label: 'Events', category: 'media_bulletin', keywords: ['festival', 'program', 'schedule', 'date'], icon: Calendar },
  { key: 'ticket', label: 'Tickets & Passes', category: 'media_bulletin', keywords: ['concert', 'match', 'booking', 'entry'], icon: Ticket },
  { key: 'camera', label: 'Photography', category: 'media_bulletin', keywords: ['studio', 'wedding', 'photo', 'media'], icon: Camera },
  { key: 'video', label: 'Videography', category: 'media_bulletin', keywords: ['youtube', 'film', 'reel', 'stream'], icon: Video },
  { key: 'image', label: 'Gallery & Media', category: 'media_bulletin', keywords: ['poster', 'banner', 'flyer', 'photo'], icon: ImageIcon },
  { key: 'music', label: 'Music & Sound', category: 'media_bulletin', keywords: ['band', 'dj', 'audio', 'concert'], icon: Music },
  { key: 'mic', label: 'Podcast & PA', category: 'media_bulletin', keywords: ['stage', 'host', 'radio', 'event'], icon: Mic },
  { key: 'radio', label: 'Local Radio', category: 'media_bulletin', keywords: ['broadcast', 'live', 'fm', 'signal'], icon: Radio },
  { key: 'tv', label: 'Cable & Media', category: 'media_bulletin', keywords: ['channel', 'cable', 'dth', 'screen'], icon: Tv },
  { key: 'message-square', label: 'Enquiries & Chat', category: 'media_bulletin', keywords: ['reviews', 'feedback', 'inbox', 'community'], icon: MessageSquare },
  { key: 'mail', label: 'Mail & Notices', category: 'media_bulletin', keywords: ['newsletter', 'email', 'letter', 'dispatch'], icon: Mail },
  { key: 'bell', label: 'Alerts', category: 'media_bulletin', keywords: ['notification', 'update', 'reminder', 'ping'], icon: Bell },

  // ADMIN (15)
  { key: 'crown', label: 'Superadmin', category: 'admin', keywords: ['master', 'root', 'governance', 'control'], icon: Crown },
  { key: 'shield', label: 'Security & Roles', category: 'admin', keywords: ['rbac', 'auth', 'protect', 'trust'], icon: Shield },
  { key: 'lock', label: 'Locked & Immutable', category: 'admin', keywords: ['guardrail', 'private', 'escrow', 'immutable'], icon: Lock },
  { key: 'users', label: 'Users & Teams', category: 'admin', keywords: ['profiles', 'staff', 'members', 'roles'], icon: Users },
  { key: 'badge-check', label: 'Verified KYC', category: 'admin', keywords: ['approved', 'kyc', 'partner', 'trust'], icon: BadgeCheck },
  { key: 'check-circle-2', label: 'Approved', category: 'admin', keywords: ['done', 'verified', 'active', 'complete'], icon: CheckCircle2 },
  { key: 'file-check-2', label: 'Verification Queue', category: 'admin', keywords: ['audit', 'license', 'document', 'review'], icon: FileCheck2 },
  { key: 'file-text', label: 'Logs & Docs', category: 'admin', keywords: ['legal', 'policy', 'terms', 'records'], icon: FileText },
  { key: 'receipt', label: 'Plans & Billing', category: 'admin', keywords: ['invoice', 'subscription', 'settlement', 'fee'], icon: Receipt },
  { key: 'sliders', label: 'Configuration', category: 'admin', keywords: ['rates', 'rules', 'fields', 'tuning'], icon: Sliders },
  { key: 'settings', label: 'System Settings', category: 'admin', keywords: ['preferences', 'flags', 'setup', 'ops'], icon: Settings },
  { key: 'layers', label: 'Command Overview', category: 'admin', keywords: ['dashboard', 'stack', 'modules', 'overview'], icon: Layers },
  { key: 'folder-tree', label: 'Taxonomy Tree', category: 'admin', keywords: ['categories', 'nested', 'hierarchy', 'tree'], icon: FolderTree },
  { key: 'database', label: 'Data & Import', category: 'admin', keywords: ['csv', 'export', 'table', 'records'], icon: Database },
  { key: 'activity', label: 'Audit & Health', category: 'admin', keywords: ['monitoring', 'events', 'logs', 'health'], icon: Activity },
  { key: 'award', label: 'Featured & Tiers', category: 'admin', keywords: ['spotlight', 'premium', 'plan', 'rank'], icon: Award },
];

const ICON_LOOKUP = new Map<string, IconRegistryItem>();
for (const item of ICON_REGISTRY) {
  ICON_LOOKUP.set(item.key, item);
}

/**
 * Normalizes either a kebab-case `icon_key` (e.g. `shopping-bag`) or a legacy
 * PascalCase Lucide icon name (e.g. `ShoppingBag`) into a canonical registry key.
 */
export function normalizeIconKey(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return 'tag';
  const trimmed = raw.trim();
  if (!trimmed) return 'tag';
  return trimmed
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

export function getIconItemByKey(raw?: string | null): IconRegistryItem {
  const normalized = normalizeIconKey(raw);
  return ICON_LOOKUP.get(normalized) ?? ICON_LOOKUP.get('tag')!;
}

export function getIconByKey(raw?: string | null): LucideIcon {
  return getIconItemByKey(raw).icon;
}
