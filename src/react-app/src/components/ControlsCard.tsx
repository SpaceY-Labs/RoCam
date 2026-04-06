/**
 * Author: Zifan Si
 * Date: 2026-02-03
 * Purpose: Displays manual camera, zoom, arm, and recording controls.
 */
import { useState } from 'react'
import { Button } from '@heroui/button'
import { Card, CardBody } from '@heroui/card'
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@heroui/modal'
import { addToast } from '@heroui/toast'
import {
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconChevronDown,
  IconHome,
  IconZoomIn,
  IconZoomOut,
} from '@tabler/icons-react'
import { useTimeoutFn } from 'react-use'
import { Trans, useLingui } from '@lingui/react/macro'

import { useRocam } from '@/network/rocamProvider'
import { getErrorMessage } from '@/utils'

/**
 * Groups manual movement, zoom, arming, and recording controls.
 *
 * @returns Card section containing the primary operator controls.
 */
export function ControlsCard() {
  const { t } = useLingui()
  const { apiClient, status } = useRocam()
  const [isArmLoading, setIsArmLoading] = useState(false)
  const [isRecordLoading, setIsRecordLoading] = useState(false)
  const [isCooldownActive, setIsCooldownActive] = useState(false)
  const [showDisarmConfirm, setShowDisarmConfirm] = useState(false)

  const isArmed = !!status?.armed
  const isRecording = !!status?.is_recording

  // A short cooldown prevents rapid duplicate control requests from the UI.
  const [, , reset] = useTimeoutFn(() => {
    setIsCooldownActive(false)
  }, 1500)

  /**
   * Starts the shared interaction cooldown used by arm and record actions.
   *
   * @returns No return value.
   */
  const startCooldown = () => {
    setIsCooldownActive(true)
    reset()
  }

  const cooldownOrLoading = isCooldownActive || isArmLoading || isRecordLoading
  const openDisarmConfirm = () => {
    if (cooldownOrLoading) return
    setShowDisarmConfirm(true)
  }

  /**
   * Toggles the armed state through the backend API.
   *
   * @returns Promise that settles after the backend request completes.
   */
  const handleToggleArm = async () => {
    if (!apiClient || cooldownOrLoading) return
    if (isArmed) {
      openDisarmConfirm()

      return
    }

    setIsArmLoading(true)
    startCooldown()
    try {
      await apiClient.arm()
    } catch (error) {
      addToast({
        title: t`Failed to arm`,
        description: getErrorMessage(error),
        color: 'danger',
      })
    } finally {
      setIsArmLoading(false)
    }
  }

  /**
   * Confirms and executes the disarm action through the backend API.
   *
   * @returns Promise that settles after the backend request completes.
   */
  const handleConfirmDisarm = async () => {
    if (!apiClient || cooldownOrLoading) return

    setIsArmLoading(true)
    startCooldown()
    try {
      await apiClient.disarm()
    } catch (error) {
      addToast({
        title: t`Failed to disarm`,
        description: getErrorMessage(error),
        color: 'danger',
      })
    } finally {
      setIsArmLoading(false)
      setShowDisarmConfirm(false)
    }
  }

  /**
   * Toggles recording through the backend API.
   *
   * @returns Promise that settles after the backend request completes.
   */
  const handleToggleRecording = async () => {
    if (!apiClient || cooldownOrLoading) return
    setIsRecordLoading(true)
    startCooldown()
    try {
      if (isRecording) {
        await apiClient.stopRecording()
        addToast({ title: t`Recording stopped`, color: 'success' })
      } else {
        await apiClient.startRecording()
        addToast({ title: t`Recording started`, color: 'success' })
      }
    } catch (error) {
      addToast({
        title: isRecording
          ? t`Failed to stop recording`
          : t`Failed to start recording`,
        description: getErrorMessage(error),
        color: 'danger',
      })
    } finally {
      setIsRecordLoading(false)
    }
  }

  return (
    <>
      <Card radius="sm">
        <CardBody className="px-6 py-5">
          <p className="text-xs font-semibold uppercase text-gray-800 tracking-widest">
            <Trans>Controls</Trans>
          </p>
          <div className="flex gap-8 mt-4">
            <GimbalPad
              isInteractionBlocked={!apiClient || cooldownOrLoading}
              onMoveAttemptWhileArmed={openDisarmConfirm}
            />
            <ZoomControls />
            <div className="flex flex-col justify-center gap-3">
              <Button
                color="danger"
                isDisabled={!apiClient || cooldownOrLoading}
                radius="sm"
                variant="bordered"
                onPress={handleToggleRecording}
              >
                {isRecording ? (
                  <Trans>Stop Recording</Trans>
                ) : (
                  <Trans>Start Recording</Trans>
                )}
              </Button>
              <Button
                className="border-amber-500 text-amber-600"
                color="warning"
                isDisabled={!apiClient || cooldownOrLoading}
                radius="sm"
                variant="bordered"
                onPress={handleToggleArm}
              >
                {isArmed ? <Trans>Disarm</Trans> : <Trans>Arm</Trans>}
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      <Modal
        isDismissable={!isArmLoading}
        isOpen={showDisarmConfirm}
        onOpenChange={(open) => setShowDisarmConfirm(open)}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>
                <Trans>Disarm and switch to manual control?</Trans>
              </ModalHeader>
              <ModalBody>
                <p className="text-sm text-gray-600">
                  <Trans>
                    Disarming will exit armed mode and re-enable manual gimbal
                    controls.
                  </Trans>
                </p>
              </ModalBody>
              <ModalFooter>
                <Button
                  isDisabled={isArmLoading}
                  radius="sm"
                  variant="light"
                  onPress={onClose}
                >
                  <Trans>Cancel</Trans>
                </Button>
                <Button
                  color="warning"
                  isLoading={isArmLoading}
                  radius="sm"
                  variant="solid"
                  onPress={handleConfirmDisarm}
                >
                  <Trans>Disarm and Manual Control</Trans>
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  )
}

type GimbalPadProps = {
  isInteractionBlocked: boolean
  onMoveAttemptWhileArmed: () => void
}

/**
 * Renders the directional pad used for manual gimbal movement commands.
 *
 * @returns Directional control grid for manual camera movement.
 */
function GimbalPad({
  isInteractionBlocked,
  onMoveAttemptWhileArmed,
}: GimbalPadProps) {
  const { t } = useLingui()
  const { apiClient, status } = useRocam()
  /**
   * Runs a movement request and reports any backend failure to the user.
   *
   * @param move Movement request executed against the backend API.
   * @param actionLabel Human-readable action label used in the error message.
   * @returns Promise that settles after the movement request completes.
   */
  const handleMove = async (
    move: () => Promise<unknown>,
    actionLabel: string
  ) => {
    try {
      await move()
    } catch (error) {
      addToast({
        title: t`Failed to move ${actionLabel}`,
        description: getErrorMessage(error),
        color: 'danger',
      })
    }
  }

  const handleDirectionPress = (
    direction: 'up' | 'down' | 'left' | 'right'
  ) => {
    if (!apiClient || isInteractionBlocked) return
    if (status?.armed) {
      onMoveAttemptWhileArmed()

      return
    }
    void handleMove(() => apiClient.manualMove(direction), direction)
  }

  const handleHomePress = () => {
    if (!apiClient || isInteractionBlocked) return
    if (status?.armed) {
      onMoveAttemptWhileArmed()

      return
    }
    void handleMove(() => apiClient.manualMoveTo(0, 0), 'home')
  }

  return (
    <div className="grid gap-2 grid-cols-3 grid-rows-3 w-fit">
      <div />
      <Button
        isIconOnly
        aria-label={t`Move up`}
        data-testid="gimbal-up"
        isDisabled={isInteractionBlocked}
        radius="sm"
        size="lg"
        variant="flat"
        onPress={() => handleDirectionPress('up')}
      >
        <IconChevronUp />
      </Button>
      <div />
      <Button
        isIconOnly
        aria-label={t`Move left`}
        data-testid="gimbal-left"
        isDisabled={isInteractionBlocked}
        radius="sm"
        size="lg"
        variant="flat"
        onPress={() => handleDirectionPress('left')}
      >
        <IconChevronLeft />
      </Button>
      <Button
        isIconOnly
        aria-label={t`Move home`}
        data-testid="gimbal-home"
        isDisabled={isInteractionBlocked}
        radius="sm"
        size="lg"
        variant="flat"
        onPress={handleHomePress}
      >
        <IconHome />
      </Button>
      <Button
        isIconOnly
        aria-label={t`Move right`}
        data-testid="gimbal-right"
        isDisabled={isInteractionBlocked}
        radius="sm"
        size="lg"
        variant="flat"
        onPress={() => handleDirectionPress('right')}
      >
        <IconChevronRight />
      </Button>
      <div />
      <Button
        isIconOnly
        aria-label={t`Move down`}
        data-testid="gimbal-down"
        isDisabled={isInteractionBlocked}
        radius="sm"
        size="lg"
        variant="flat"
        onPress={() => handleDirectionPress('down')}
      >
        <IconChevronDown />
      </Button>
      <div />
    </div>
  )
}

/**
 * Renders focal-length controls that step within the backend-reported range.
 *
 * @returns Zoom control buttons for the current camera session.
 */
function ZoomControls() {
  const { t } = useLingui()
  const { apiClient, status } = useRocam()
  const disabled = !!status?.armed

  const focalAvailable =
    status?.focal_length_mm != null &&
    status?.focal_length_min_mm != null &&
    status?.focal_length_max_mm != null

  /**
   * Steps the focal length in the requested direction.
   *
   * @param direction Zoom direction requested by the operator.
   * @returns Promise that settles after the focal-length request completes.
   */
  const handleZoom = async (direction: 'in' | 'out') => {
    if (!apiClient || !status || !focalAvailable) return
    const range = status.focal_length_max_mm - status.focal_length_min_mm
    const step = Math.max(1, range * 0.1)
    const delta = direction === 'in' ? step : -step
    const newFocal = Math.max(
      status.focal_length_min_mm,
      Math.min(status.focal_length_max_mm, status.focal_length_mm + delta)
    )

    try {
      await apiClient.setFocalLength(newFocal)
    } catch (error) {
      addToast({
        title: t`Failed to set focal length`,
        description: getErrorMessage(error),
        color: 'danger',
      })
    }
  }

  return (
    <div className="flex flex-col justify-center gap-2">
      <Button
        isIconOnly
        disabled={disabled || !focalAvailable}
        radius="sm"
        size="lg"
        variant="flat"
        onPress={() => void handleZoom('in')}
      >
        <IconZoomIn />
      </Button>
      <Button
        isIconOnly
        disabled={disabled || !focalAvailable}
        radius="sm"
        size="lg"
        variant="flat"
        onPress={() => void handleZoom('out')}
      >
        <IconZoomOut />
      </Button>
    </div>
  )
}
