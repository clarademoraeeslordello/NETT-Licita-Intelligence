/**
 * Ícones SVG inline (stroke 1.6, grade 24x24) — sem dependência externa.
 * Mantém o bundle leve e garante renderização idêntica no relatório.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 20, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconDocument = (props: IconProps) => (
  <Base {...props}>
    <path d="M14 3v4a1 1 0 0 0 1 1h4" />
    <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" />
    <path d="M9 13h6M9 17h4" />
  </Base>
);

export const IconSparkles = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" />
    <path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z" />
    <path d="M5 15l.6 1.4L7 17l-1.4.6L5 19l-.6-1.4L3 17l1.4-.6L5 15Z" />
  </Base>
);

export const IconUpload = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 16V4" />
    <path d="m8 8 4-4 4 4" />
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </Base>
);

export const IconDownload = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 4v12" />
    <path d="m8 12 4 4 4-4" />
    <path d="M4 20h16" />
  </Base>
);

export const IconCheck = (props: IconProps) => (
  <Base {...props}>
    <path d="m5 13 4 4L19 7" />
  </Base>
);

export const IconCheckCircle = (props: IconProps) => (
  <Base {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12.5 2.5 2.5 4.5-5" />
  </Base>
);

export const IconAlert = (props: IconProps) => (
  <Base {...props}>
    <path d="M10.3 4.3 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4M12 17h.01" />
  </Base>
);

export const IconAlertTriangle = IconAlert;

export const IconClock = (props: IconProps) => (
  <Base {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Base>
);

export const IconCurrency = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 3v18" />
    <path d="M16.5 7.5c-.9-1-2.4-1.5-4.2-1.5-2.3 0-3.8 1-3.8 2.6 0 1.7 1.7 2.3 4 2.9 2.5.6 4.3 1.2 4.3 3.1 0 1.8-1.7 2.9-4.2 2.9-2 0-3.6-.6-4.6-1.7" />
  </Base>
);

export const IconBuilding = (props: IconProps) => (
  <Base {...props}>
    <path d="M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16" />
    <path d="M15 9h3a2 2 0 0 1 2 2v10" />
    <path d="M8 7h3M8 11h3M8 15h3M2 21h20" />
  </Base>
);

export const IconBox = (props: IconProps) => (
  <Base {...props}>
    <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
    <path d="m4.5 7.8 7.5 4.2 7.5-4.2M12 12v9" />
  </Base>
);

export const IconShield = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 3l7 3v5.5c0 4.3-2.9 8.3-7 9.5-4.1-1.2-7-5.2-7-9.5V6l7-3Z" />
    <path d="m9 12 2 2 4-4" />
  </Base>
);

export const IconList = (props: IconProps) => (
  <Base {...props}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <path d="M5 6h.01M5 12h.01M5 18h.01" />
  </Base>
);

export const IconGavel = (props: IconProps) => (
  <Base {...props}>
    <path d="m14 6 4 4-6 6-4-4 6-6Z" />
    <path d="m9 11-5 5 4 4 5-5" />
    <path d="M17 3 21 7" />
  </Base>
);

export const IconTarget = (props: IconProps) => (
  <Base {...props}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3.5" />
    <path d="M12 4V2M12 22v-2M4 12H2M22 12h-2" />
  </Base>
);

export const IconFileCheck = (props: IconProps) => (
  <Base {...props}>
    <path d="M14 3v4a1 1 0 0 0 1 1h4" />
    <path d="M19 12.5V8l-5-5H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5" />
    <path d="m14 18 2 2 4-4" />
  </Base>
);

export const IconTrending = (props: IconProps) => (
  <Base {...props}>
    <path d="M3 17l5.5-5.5 3.5 3.5L21 6" />
    <path d="M15 6h6v6" />
  </Base>
);

export const IconChevron = (props: IconProps) => (
  <Base {...props}>
    <path d="m9 6 6 6-6 6" />
  </Base>
);

export const IconRefresh = (props: IconProps) => (
  <Base {...props}>
    <path d="M20 11A8 8 0 0 0 6.3 6.3L4 8.5" />
    <path d="M4 4v4.5h4.5" />
    <path d="M4 13a8 8 0 0 0 13.7 4.7L20 15.5" />
    <path d="M20 20v-4.5h-4.5" />
  </Base>
);

export const IconPrint = (props: IconProps) => (
  <Base {...props}>
    <path d="M7 8V3h10v5" />
    <path d="M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
    <path d="M7 14h10v7H7z" />
  </Base>
);

export const IconLock = (props: IconProps) => (
  <Base {...props}>
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </Base>
);

export const IconPlay = (props: IconProps) => (
  <Base {...props}>
    <path d="M7 4.5v15l13-7.5-13-7.5Z" />
  </Base>
);

export const IconWand = (props: IconProps) => (
  <Base {...props}>
    <path d="m5 19 9-9" />
    <path d="M14.5 4.5 15 3l.5 1.5L17 5l-1.5.5L15 7l-.5-1.5L13 5l1.5-.5Z" />
    <path d="M19 11l.4 1.1L20.5 12.5l-1.1.4L19 14l-.4-1.1L17.5 12.5l1.1-.4L19 11Z" />
    <path d="m4 20 12-12 1.5 1.5L5.5 21.5 4 20Z" />
  </Base>
);

export const IconCode = (props: IconProps) => (
  <Base {...props}>
    <path d="m8 8-4 4 4 4M16 8l4 4-4 4M13 5l-2 14" />
  </Base>
);

export const IconDatabase = (props: IconProps) => (
  <Base {...props}>
    <ellipse cx="12" cy="6" rx="7" ry="3" />
    <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
    <path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
  </Base>
);

export const IconLayers = (props: IconProps) => (
  <Base {...props}>
    <path d="m12 3 9 5-9 5-9-5 9-5Z" />
    <path d="m3 13 9 5 9-5" />
  </Base>
);

/* ---------------------------- Plataforma ---------------------------- */

export const IconRadar = (props: IconProps) => (
  <Base {...props}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <path d="M12 12 18.5 5.5" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
  </Base>
);

export const IconKanban = (props: IconProps) => (
  <Base {...props}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16M15 4v16" />
    <path d="M5.5 8h1.5M11 8h2M17 8h1.5M11 11.5h2" />
  </Base>
);

export const IconCalendar = (props: IconProps) => (
  <Base {...props}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
    <path d="M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01" />
  </Base>
);

export const IconFolder = (props: IconProps) => (
  <Base {...props}>
    <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7.5Z" />
    <path d="m9 14 2 2 4-4" />
  </Base>
);

export const IconChart = (props: IconProps) => (
  <Base {...props}>
    <path d="M4 4v16h16" />
    <path d="M8 16v-4M12 16V8M16 16v-6" />
  </Base>
);

export const IconHome = (props: IconProps) => (
  <Base {...props}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="4.5" rx="1.5" />
    <rect x="13.5" y="11" width="7" height="9.5" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
  </Base>
);

export const IconUser = (props: IconProps) => (
  <Base {...props}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 20.5c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5" />
  </Base>
);

export const IconPlus = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 5v14M5 12h14" />
  </Base>
);

export const IconX = (props: IconProps) => (
  <Base {...props}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Base>
);

export const IconExternal = (props: IconProps) => (
  <Base {...props}>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </Base>
);

export const IconSearch = (props: IconProps) => (
  <Base {...props}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Base>
);

export const IconArrowRight = (props: IconProps) => (
  <Base {...props}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Base>
);

export const IconTrash = (props: IconProps) => (
  <Base {...props}>
    <path d="M4 7h16M10 11v6M14 11v6" />
    <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7" />
  </Base>
);

export const IconTrophy = (props: IconProps) => (
  <Base {...props}>
    <path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" />
    <path d="M16 6h3a3 3 0 0 1-3 4M8 6H5a3 3 0 0 0 3 4" />
    <path d="M12 13v4M8.5 20.5h7M10 17h4v3.5h-4z" />
  </Base>
);

export const IconMapPin = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
    <circle cx="12" cy="10" r="2.3" />
  </Base>
);

export const IconMenu = (props: IconProps) => (
  <Base {...props}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Base>
);

export const IconBell = (props: IconProps) => (
  <Base {...props}>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16Z" />
    <path d="M10 20.5a2 2 0 0 0 4 0" />
  </Base>
);

export const IconGrip = (props: IconProps) => (
  <Base {...props}>
    <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" strokeWidth={2.6} />
  </Base>
);
