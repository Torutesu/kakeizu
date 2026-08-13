import { useCallback, useState } from 'react'
import { DEFAULT_ZOOM_SETTINGS, ZOOM_SETTINGS_CONFIG, ZoomSettings } from '../constants/config'

// 壊れた・改ざんされたlocalStorage値（0, 負数, NaN, 範囲外など）でズームが
// 効かなくなったり暴走したりしないよう、設定範囲内に丸める
function clamp(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function loadFromLocalStorage(): ZoomSettings {
  if (typeof window === 'undefined') return DEFAULT_ZOOM_SETTINGS
  try {
    const raw = window.localStorage.getItem(ZOOM_SETTINGS_CONFIG.storageKey)
    if (!raw) return DEFAULT_ZOOM_SETTINGS
    const parsed = JSON.parse(raw)
    return {
      wheelSensitivity: clamp(
        parsed.wheelSensitivity,
        ZOOM_SETTINGS_CONFIG.wheelSensitivity.min,
        ZOOM_SETTINGS_CONFIG.wheelSensitivity.max,
        DEFAULT_ZOOM_SETTINGS.wheelSensitivity
      ),
      buttonZoomStep: clamp(
        parsed.buttonZoomStep,
        ZOOM_SETTINGS_CONFIG.buttonZoomStep.min,
        ZOOM_SETTINGS_CONFIG.buttonZoomStep.max,
        DEFAULT_ZOOM_SETTINGS.buttonZoomStep
      ),
      alwaysShowGenerationGuides: typeof parsed.alwaysShowGenerationGuides === 'boolean'
        ? parsed.alwaysShowGenerationGuides
        : DEFAULT_ZOOM_SETTINGS.alwaysShowGenerationGuides,
    }
  } catch (err) {
    console.warn('ズーム設定の読み込みに失敗しました:', err)
    return DEFAULT_ZOOM_SETTINGS
  }
}

function saveToLocalStorage(settings: ZoomSettings) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(ZOOM_SETTINGS_CONFIG.storageKey, JSON.stringify(settings))
  } catch (err) {
    console.warn('ズーム設定の保存に失敗しました:', err)
  }
}

interface UseZoomSettingsReturn {
  zoomSettings: ZoomSettings
  setWheelSensitivity: (value: number) => void
  setButtonZoomStep: (value: number) => void
  setAlwaysShowGenerationGuides: (value: boolean) => void
  resetZoomSettings: () => void
}

export function useZoomSettings(): UseZoomSettingsReturn {
  const [zoomSettings, setZoomSettings] = useState<ZoomSettings>(() => loadFromLocalStorage())

  const updateSettings = useCallback((updates: Partial<ZoomSettings>) => {
    setZoomSettings(prev => {
      const next = { ...prev, ...updates }
      saveToLocalStorage(next)
      return next
    })
  }, [])

  const setWheelSensitivity = useCallback((value: number) => {
    updateSettings({
      wheelSensitivity: clamp(
        value,
        ZOOM_SETTINGS_CONFIG.wheelSensitivity.min,
        ZOOM_SETTINGS_CONFIG.wheelSensitivity.max,
        DEFAULT_ZOOM_SETTINGS.wheelSensitivity
      ),
    })
  }, [updateSettings])

  const setButtonZoomStep = useCallback((value: number) => {
    updateSettings({
      buttonZoomStep: clamp(
        value,
        ZOOM_SETTINGS_CONFIG.buttonZoomStep.min,
        ZOOM_SETTINGS_CONFIG.buttonZoomStep.max,
        DEFAULT_ZOOM_SETTINGS.buttonZoomStep
      ),
    })
  }, [updateSettings])

  const setAlwaysShowGenerationGuides = useCallback((value: boolean) => {
    updateSettings({ alwaysShowGenerationGuides: value })
  }, [updateSettings])

  const resetZoomSettings = useCallback(() => {
    setZoomSettings(DEFAULT_ZOOM_SETTINGS)
    saveToLocalStorage(DEFAULT_ZOOM_SETTINGS)
  }, [])

  return {
    zoomSettings,
    setWheelSensitivity,
    setButtonZoomStep,
    setAlwaysShowGenerationGuides,
    resetZoomSettings,
  }
}
