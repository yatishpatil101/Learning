/* Icon.jsx — maps kebab-name strings to Phosphor icons.
   Lucide is kept as fallback for the handful of icons Phosphor doesn't cover. */

// ── Phosphor icons ────────────────────────────────────────────────────────────
import {
  Airplane, Armchair, ArrowClockwise, ArrowCounterClockwise, ArrowLeft, ArrowRight, ArrowUp,
  ArrowsLeftRight, ArrowsOut, Bank, Barbell, Bathtub, BatteryCharging, Bed, Bell,
  BellSlash, Bookmark, Briefcase, Building, Buildings, Calculator, Calendar, CalendarCheck,
  CalendarHeart, Camera, Car, CaretDown, CaretLeft, CaretRight, Certificate, ChartBar,
  ChartLine, ChartLineUp, Chat, ChatCircle, ChatText, Check, CheckCircle, Checks, Circle,
  CircleNotch, ClipboardText, Clock, ClockCounterClockwise, CloudArrowUp, Compass, Confetti,
  Couch, Copy, Cpu, CreditCard, CurrencyInr, Database, DeviceMobile, Dog, DoorOpen, DotsThree,
  Download, Envelope, Eye, Faders, FadersHorizontal, Fan, FileArrowUp, FileLock,
  FileMagnifyingGlass, FileText, Fingerprint, Fire, Flag, FloppyDisk, Folder, FolderLock,
  FolderOpen, ForkKnife, Gavel, Gift, Globe, GraduationCap, Hammer, HandCoins, HandHeart,
  Handshake, HardHat, Headset, Heart, House, Image, Info, Key, Lamp, Lifebuoy,
  Lightbulb, Lightning, LinkSimple, List, ListChecks, Lock, MagnifyingGlass, MapPin, MapTrifold,
  Megaphone, Minus, NavigationArrow, Note, Package, PaintRoller, Palette, PaperPlaneTilt,
  Paperclip, PawPrint, PenNib, Pencil, Percent, Phone, PhoneCall, PhoneSlash,
  PiggyBank, Play, Plus, PlusCircle, Question, Receipt, Repeat, Rocket, Rows, Ruler,
  Scales, SealCheck, Share, Shield, ShieldCheck, ShieldWarning, ShoppingBag, SignIn,
  SignOut, Signature, SlidersHorizontal, Sparkle, SquaresFour, Stack, Star, StarHalf,
  Sun, Table, Tag, Television, Timer, Toolbox, Train, Trash, Tray, Tree, TrendDown, TrendUp,
  Truck, Upload, User, UserCheck, UserCircle, UserGear, UserPlus, Users, UsersThree,
  Video, Wallet, Warehouse, Warning, Waves, Wind, X, XCircle,
  BookOpenText, ThumbsUp, ThumbsDown,
} from '@phosphor-icons/react';

// ── Lucide fallbacks (icons not in Phosphor) ─────────────────────────────────
import {
  WashingMachine, Microwave, AirVent, Refrigerator,
  // layout / nav helpers not in Phosphor
  LayoutGrid, Maximize2, ChevronDown, ChevronLeft, ChevronRight,
  ConciergeBell, GitCompare, RotateCcw, LockKeyhole,
  CheckCheck, MessagesSquare, UploadCloud, RefreshCw,
  RectangleVertical, LampCeiling, ScrollText, Blinds, Droplets,
  ShowerHead, Sofa, ParkingCircle, TreePine, MoveVertical,
  HeartHandshake, UserRound, CheckCircle2, Zap, PartyPopper,
  BadgeCheck, BadgePercent, BadgeIndianRupee, IndianRupee,
  FileCheck, FileSignature, FilePenLine, FileSearch, FileCheck2, FileLock2, FileClock, FileBadge,
  FolderCheck, SearchCheck, Workflow, PenTool, PenLine, PawPrint as LucidePaw,
  Milestone, TrainFront, ChevronsLeftRight, LineChart, BarChart3,
  ReceiptIndianRupee, CalendarClock, CalendarDays, BedDouble,
  UserSearch, UserCog, Expand, Maximize, History, Inbox, TicketPlus, Ticket,
  Bug, ImagePlus,
  CircleCheck, LifeBuoy, Loader, FolderOpen as LucideFolderOpen,
  FileUp, Landmark, Navigation, Map, Truck as LucideTruck,
  Home, Menu, MessageCircle, MessageSquare, MessageSquareText,
  Gauge, FolderPlus, FolderX, AlertCircle, ExternalLink,
  Send, LogIn, LogOut, Box, Armchair as LucideArmchair,
  Phone as LucidePhone, Bell as LucideBell, Star as LucideStar,
  Heart as LucideHeart, Shield as LucideShield,
} from 'lucide-react';

/* ─────────────────────────────────────────────────────────────────────────────
   Name → component map.
   Phosphor entries first; Lucide fallbacks at the end for anything not covered.
   ───────────────────────────────────────────────────────────────────────────── */
const MAP = {
  // ── Navigation & UI chrome ─────────────────────────────────────────────────
  'arrow-right':         ArrowRight,
  'arrow-left':          ArrowLeft,
  'arrow-up':            ArrowUp,
  'caret-down':          CaretDown,
  'caret-left':          CaretLeft,
  'caret-right':         CaretRight,
  'chevron-down':        ChevronDown,       // Lucide fallback (keeps existing usage)
  'chevron-left':        ChevronLeft,
  'chevron-right':       ChevronRight,
  menu:                  Menu,              // Lucide fallback
  search:                MagnifyingGlass,
  'sliders-horizontal':  FadersHorizontal,
  expand:                ArrowsOut,
  maximize:              ArrowsOut,
  'maximize-2':          ArrowsOut,
  'layout-grid':         SquaresFour,
  list:                  Rows,
  'move-vertical':       MoveVertical,       // Lucide fallback

  // ── Actions ────────────────────────────────────────────────────────────────
  plus:                  Plus,
  'plus-circle':         PlusCircle,
  minus:                 Minus,
  x:                     X,
  'x-circle':            XCircle,
  check:                 Check,
  'check-circle':        CheckCircle,
  'check-circle-2':      CheckCircle2,      // Lucide fallback
  'circle-check':        CheckCircle,
  'check-check':         Checks,
  'checks-square':       Checks,
  save:                  FloppyDisk,
  copy:                  Copy,
  share: Share,
  'share-2':             Share,
  download:              Download,
  upload:                Upload,
  'upload-cloud':        CloudArrowUp,
  'cloud-upload':        CloudArrowUp,
  'file-up':             FileArrowUp,
  'rotate-ccw':          ArrowCounterClockwise,
  'refresh-cw':          ArrowClockwise,
  repeat:                Repeat,
  send:                  PaperPlaneTilt,
  'trash-2':             Trash,

  // ── Auth & security ────────────────────────────────────────────────────────
  lock:                  Lock,
  'lock-keyhole':        LockKeyhole,       // Lucide fallback
  fingerprint:           Fingerprint,
  shield:                Shield,
  'shield-check':        ShieldCheck,
  'shield-alert':        ShieldWarning,
  'folder-lock':         FolderLock,
  'file-lock-2':         FileLock,
  'log-in':              SignIn,
  'log-out':             SignOut,

  // ── Communication ──────────────────────────────────────────────────────────
  mail:                  Envelope,
  phone:                 Phone,
  'phone-call':          PhoneCall,
  'phone-off':           PhoneSlash,
  bell:                  Bell,
  'bell-plus':           Bell,
  'message-circle':      ChatCircle,
  'message-square':      Chat,
  'message-square-text': ChatText,
  'messages-square':     Chat,
  info:                  Info,
  'help-circle':         Question,
  headset:               Headset,
  megaphone:             Megaphone,

  // ── People ─────────────────────────────────────────────────────────────────
  user:                  User,
  'user-check':          UserCheck,
  'user-round':          UserCircle,
  'user-plus':           UserPlus,
  'user-search':         UserSearch,        // Lucide fallback
  'user-cog':            UserGear,
  users:                 Users,
  'users-round':         UsersThree,
  venus:                 UserCircle,
  mars:                  UserCircle,

  // ── Property / real-estate ────────────────────────────────────────────────
  home:                  House,
  house:                 House,
  building:              Building,
  'building-2':          Buildings,
  landmark:              Bank,
  bed:                   Bed,
  'bed-double':          BedDouble,         // Lucide fallback
  bath:                  Bathtub,
  sofa:                  Couch,
  armchair:              Armchair,
  'shower-head':         ShowerHead,        // Lucide fallback
  ruler:                 Ruler,
  'paint-roller':        PaintRoller,
  palette:               Palette,
  'hard-hat':            HardHat,
  warehouse:             Warehouse,
  'door-open':           DoorOpen,
  key:                   Key,
  'key-round':           Key,
  'paw-print':           PawPrint,
  dog:                   Dog,
  'parking-circle':      ParkingCircle,    // Lucide fallback

  // ── Finance & commerce ────────────────────────────────────────────────────
  'indian-rupee':             CurrencyInr,
  'badge-indian-rupee':       BadgeIndianRupee,   // Lucide fallback
  'receipt-indian-rupee':     ReceiptIndianRupee, // Lucide fallback
  'badge-percent':            BadgePercent,       // Lucide fallback
  'badge-check':              SealCheck,
  calculator:                 Calculator,
  wallet:                     Wallet,
  'credit-card':              CreditCard,
  'piggy-bank':               PiggyBank,
  percent:                    Percent,
  scale:                      Scales,
  tag:                        Tag,
  receipt:                    Receipt,
  'hand-coins':               HandCoins,
  'hand-heart':               HandHeart,
  handshake:                  Handshake,
  'heart-handshake':          HeartHandshake,    // Lucide fallback
  truck:                      Truck,
  toolbox:                    Toolbox,
  package:                    Package,

  // ── Navigation & location ─────────────────────────────────────────────────
  map:                   MapTrifold,
  'map-pin':             MapPin,
  'map-pinned':          MapPin,
  navigation:            NavigationArrow,
  compass:               Compass,
  globe:                 Globe,
  flag:                  Flag,
  milestone:             Milestone,         // Lucide fallback
  'train-front':         Train,
  plane:                 Airplane,

  // ── Charts & data ─────────────────────────────────────────────────────────
  'trending-up':         TrendUp,
  'trending-down':       TrendDown,
  'bar-chart-3':         ChartBar,
  'line-chart':          ChartLineUp,
  'chart-line':          ChartLine,
  database:              Database,
  'git-compare':         GitCompare,        // Lucide fallback
  workflow:              Workflow,          // Lucide fallback
  'chevrons-left-right': ChevronsLeftRight, // Lucide fallback

  // ── Files & documents ────────────────────────────────────────────────────
  'file-text':           FileText,
  'file-check':          FileCheck,
  'file-check-2':        FileCheck2,        // Lucide fallback
  'file-pen-line':       PenLine,
  'file-signature':      Signature,
  'file-search':         FileMagnifyingGlass,
  'file-clock':          FileClock,         // Lucide fallback
  'file-badge':          FileBadge,         // Lucide fallback
  'folder-check':        FolderCheck,       // Lucide fallback
  'search-check':        SearchCheck,       // Lucide fallback
  'clipboard-list':      ClipboardText,
  paperclip:             Paperclip,
  'scroll-text':         Note,
  table:                 Table,

  // ── Editing & writing ────────────────────────────────────────────────────
  pencil:                Pencil,
  'pen-line':            PenLine,
  'pen-tool':            PenNib,
  'pan-tool':            PenNib,

  // ── Media ────────────────────────────────────────────────────────────────
  camera:                Camera,
  video:                 Video,
  image:                 Image,
  'image-plus':          ImagePlus,         // Lucide fallback
  play:                  Play,
  tv:                    Television,

  // ── Amenities & appliances ───────────────────────────────────────────────
  refrigerator:          Refrigerator,      // Lucide fallback
  'washing-machine':     WashingMachine,    // Lucide fallback
  microwave:             Microwave,         // Lucide fallback
  'air-vent':            AirVent,           // Lucide fallback
  'cooking-pot':         ForkKnife,
  utensils:              ForkKnife,
  fan:                   Fan,
  blinds:                Blinds,            // Lucide fallback
  droplets:              Droplets,          // Lucide fallback
  lamp:                  Lamp,
  'lamp-ceiling':        LampCeiling,       // Lucide fallback
  lightbulb:             Lightbulb,
  wifi:                  Lightning,
  'battery-charging':    BatteryCharging,
  shirt:                 Barbell,           // closest Phosphor — shirt not in Phosphor
  dumbbell:              Barbell,

  // ── Nature & outdoors ────────────────────────────────────────────────────
  trees:                 Tree,
  'tree-pine':           Tree,
  sun:                   Sun,
  waves:                 Waves,
  flame:                 Fire,
  wind:                  Wind,

  // ── Misc UI ───────────────────────────────────────────────────────────────
  star:                  Star,
  'star-half':           StarHalf,
  heart:                 Heart,
  bookmark:              Bookmark,
  rocket:                Rocket,
  sparkles:              Sparkle,
  zap:                   Lightning,
  'party-popper':        Confetti,
  gift:                  Gift,
  circle:                Circle,
  'circle-notch':        CircleNotch,
  loader:                CircleNotch,
  'loader-2':            CircleNotch,
  box:                   Package,
  layers:                Stack,
  smartphone:            DeviceMobile,
  cpu:                   Cpu,
  'graduation-cap':      GraduationCap,
  'shopping-bag':        ShoppingBag,
  'life-buoy':           Lifebuoy,
  inbox:                 Tray,
  ticket:                Ticket,            // Lucide fallback
  'ticket-plus':         TicketPlus,        // Lucide fallback
  bug:                   Bug,               // Lucide fallback
  history:               ClockCounterClockwise,
  timer:                 Timer,
  calendar:              Calendar,
  'calendar-check':      CalendarCheck,
  'calendar-days':       CalendarDays,      // Lucide fallback
  'calendar-heart':      CalendarHeart,
  'calendar-clock':      CalendarClock,     // Lucide fallback
  clock:                 Clock,
  eye:                   Eye,
  'alert-triangle':      Warning,
  hammer:                Hammer,
  gavel:                 Gavel,
  briefcase:             Briefcase,
  car:                   Car,
  'car-front':           Car,
  'concierge-bell':      Bell,
  'rectangle-vertical':  RectangleVertical, // Lucide fallback
  'folder-open':         FolderOpen,
  'folder-plus':         FolderPlus,        // Lucide fallback
  'folder-x':            FolderX,           // Lucide fallback
  gauge:                 Gauge,             // Lucide fallback
  'alert-circle':        AlertCircle,       // Lucide fallback
  'external-link':       ExternalLink,      // Lucide fallback
  link:                  LinkSimple,
  'more-horizontal':     DotsThree,

  // ── Help centre / documentation ────────────────────────────────────────────
  'user-circle':         UserCircle,
  'clipboard-text':      ClipboardText,
  warning:               Warning,
  sparkle:               Sparkle,
  'book-open':           BookOpenText,
  'thumbs-up':           ThumbsUp,
  'thumbs-down':         ThumbsDown,
};

export default function Icon({ name, className, ...rest }) {
  const Cmp = MAP[name] || House;
  return <Cmp className={className} {...rest} />;
}
