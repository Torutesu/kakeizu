'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Button } from './ui/button'
import { Slider } from './ui/slider'
import { Label } from './ui/label'
import { Switch } from './ui/switch'
import { RotateCcw } from 'lucide-react'
import { ZOOM_SETTINGS_CONFIG, ZoomSettings } from '../constants/config'

interface SettingsDialogProps {
  isOpen: boolean
  onClose: () => void
  zoomSettings: ZoomSettings
  onWheelSensitivityChange: (value: number) => void
  onButtonZoomStepChange: (value: number) => void
  onAlwaysShowGenerationGuidesChange: (value: boolean) => void
  onReset: () => void
}

export function SettingsDialog({
  isOpen,
  onClose,
  zoomSettings,
  onWheelSensitivityChange,
  onButtonZoomStepChange,
  onAlwaysShowGenerationGuidesChange,
  onReset,
}: SettingsDialogProps) {
  const { wheelSensitivity, buttonZoomStep } = ZOOM_SETTINGS_CONFIG

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>設定</DialogTitle>
          <DialogDescription>
            ズーム・ピンチ操作の感度を調整できます。設定はブラウザに自動保存されます。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="wheel-sensitivity">
                ズーム・ピンチ感度
              </Label>
              <span className="text-sm text-gray-500 tabular-nums">
                {zoomSettings.wheelSensitivity.toFixed(1)}
              </span>
            </div>
            <Slider
              id="wheel-sensitivity"
              value={[zoomSettings.wheelSensitivity]}
              min={wheelSensitivity.min}
              max={wheelSensitivity.max}
              step={wheelSensitivity.step}
              onValueChange={([value]) => onWheelSensitivityChange(value)}
            />
            <p className="text-xs text-gray-500">
              マウスホイールやトラックパッドのピンチ操作でのズームの効き具合です。値を大きくすると少ない操作で大きく拡大・縮小されます。
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="button-zoom-step">
                ズームボタンの拡大率
              </Label>
              <span className="text-sm text-gray-500 tabular-nums">
                {Math.round((zoomSettings.buttonZoomStep - 1) * 100)}%
              </span>
            </div>
            <Slider
              id="button-zoom-step"
              value={[zoomSettings.buttonZoomStep]}
              min={buttonZoomStep.min}
              max={buttonZoomStep.max}
              step={buttonZoomStep.step}
              onValueChange={([value]) => onButtonZoomStepChange(value)}
            />
            <p className="text-xs text-gray-500">
              画面左上の「＋」「－」ボタンを1回押した際に拡大・縮小される割合です。
            </p>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="always-show-generation-guides">
                世代ガイドを常に表示
              </Label>
              <p className="text-xs text-gray-500">
                青い「第N世代」ラインを、人物カードをドラッグしている間だけでなく常に表示します。
              </p>
            </div>
            <Switch
              id="always-show-generation-guides"
              checked={zoomSettings.alwaysShowGenerationGuides}
              onCheckedChange={onAlwaysShowGenerationGuidesChange}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onReset}>
            <RotateCcw className="w-4 h-4 mr-2" />
            初期設定に戻す
          </Button>
          <Button size="sm" onClick={onClose}>
            閉じる
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
