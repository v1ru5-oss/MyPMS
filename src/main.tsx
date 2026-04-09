import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource-variable/geist/index.css'
import '@/css/main.css'
import { LoginRouteThemeControl } from '@/components/LoginRouteThemeControl'
import { TailwindRoot } from '@/components/TailwindRoot'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider } from '@/contexts/AuthContext'
import { ThemeProvider } from '@/contexts/ThemeProvider'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <TooltipProvider delayDuration={280} skipDelayDuration={120}>
            <TailwindRoot>
              <LoginRouteThemeControl />
              <App />
            </TailwindRoot>
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
