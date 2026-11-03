export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox='0 0 32 32' fill='none' xmlns='http://www.w3.org/2000/svg' aria-hidden='true' className='shrink-0'>
      <g stroke='currentColor' fill='none' strokeLinecap='round'>
        <path d='M20 4.5C20 9.2 21 10.2 25.5 11C21 11.8 20 12.8 20 17.5C20 12.8 19 11.8 14.5 11C19 10.2 20 9.2 20 4.5Z' stroke='var(--brand)' strokeWidth='1.6' strokeLinejoin='round' />
        <path d='M3 25h9.5M16 25h13' strokeWidth='1.8' />
        <path d='M8 28.5h16' strokeWidth='1.3' opacity='.45' />
      </g>
    </svg>
  )
}
