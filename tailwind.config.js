/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,js,ts,svelte}'],
  theme: {
    extend: {
      colors: {
        cocoon: {
          bg: 'var(--cocoon-bg)',
          surface: 'var(--cocoon-surface)',
          elevated: 'var(--cocoon-elevated)',
          text: 'var(--cocoon-text)',
          muted: 'var(--cocoon-muted)',
          accent: 'var(--cocoon-accent)',
          'accent-fg': 'var(--cocoon-accent-fg)',
          border: 'var(--cocoon-border)',
          dim: 'var(--cocoon-dim)',
          coral: 'var(--cocoon-coral)',
          mint: 'var(--cocoon-mint)',
          lavender: 'var(--cocoon-lavender)',
        },
      },
      fontFamily: {
        heading: ['var(--font-heading)'],
      },
      keyframes: {
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.95)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'pill-pop': {
          '0%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.08)' },
          '100%': { transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.4s ease-out',
        'scale-in': 'scale-in 0.3s ease-out',
        'pill-pop': 'pill-pop 0.2s ease-out',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
    require('@tailwindcss/forms'),
  ],
};
