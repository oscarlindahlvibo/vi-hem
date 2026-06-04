interface AppLogoProps {
  className?: string;
}

export function AppLogo({ className = '' }: AppLogoProps) {
  return (
    <img
      src="/icons/vi-hem-icon.svg"
      alt="VI-HEM"
      className={`block rounded-[inherit] ${className}`}
      draggable={false}
    />
  );
}
