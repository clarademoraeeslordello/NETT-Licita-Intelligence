/** Ícones auxiliares usados dentro dos blocos de dados. */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Mini({ size = 16, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconCheck = (props: IconProps) => (
  <Mini {...props}>
    <path d="m5 13 4 4L19 7" />
  </Mini>
);

export const IconAlert = (props: IconProps) => (
  <Mini {...props}>
    <path d="M12 8v5M12 17h.01" />
    <circle cx="12" cy="12" r="9" strokeWidth={1.8} />
  </Mini>
);

export const IconQuestion = (props: IconProps) => (
  <Mini {...props}>
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7v.5M12 17h.01" />
    <circle cx="12" cy="12" r="9" strokeWidth={1.8} />
  </Mini>
);
