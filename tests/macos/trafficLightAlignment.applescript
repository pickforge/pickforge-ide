-- Run against an open dev app, passing its visible zoom factor:
-- osascript tests/macos/trafficLightAlignment.applescript pickforge-tauri 1.25
on run argv
  set processName to "pickforge-tauri"
  set zoomFactor to 1
  if (count argv) > 0 then set processName to item 1 of argv
  if (count argv) > 1 then set zoomFactor to item 2 of argv as real
  set originalState to captureWindowState(processName)

  try
    resetWindow(processName)
    set reports to {}
    assertAligned(processName, zoomFactor, "at startup", reports)
    fullscreenRoundTrip(processName)
    fullscreenRoundTrip(processName)
    resizeTopEdge(processName)
    assertAligned(processName, zoomFactor, "after fullscreen + resize", reports)
    set output to joinLines(reports)
    restoreWindow(processName, originalState)
    return output
  on error errorMessage number errorNumber
    restoreWindow(processName, originalState)
    error errorMessage number errorNumber
  end try
end run

on captureWindowState(processName)
  tell application "System Events"
    tell process processName
      set w to first window whose name is "PickForge"
      if value of attribute "AXFullScreen" of w then error "traffic-light check requires a windowed PickForge app"
      return {position of w, size of w}
    end tell
  end tell
end captureWindowState

on restoreWindow(processName, originalState)
  try
    tell application "System Events"
      tell process processName
        set w to first window whose name is "PickForge"
        if value of attribute "AXFullScreen" of w then set value of attribute "AXFullScreen" of w to false
        set position of w to item 1 of originalState
        set size of w to item 2 of originalState
      end tell
    end tell
  end try
end restoreWindow

on resetWindow(processName)
  tell application "System Events"
    tell process processName
      set frontmost to true
      set w to first window whose name is "PickForge"
      set position of w to {160, 100}
      set size of w to {1000, 700}
    end tell
  end tell
  delay 0.3
end resetWindow

on fullscreenRoundTrip(processName)
  tell application "System Events"
    tell process processName
      set w to first window whose name is "PickForge"
      set value of attribute "AXFullScreen" of w to true
    end tell
  end tell
  waitForFullscreen(processName, true)
  delay 0.3
  tell application "System Events"
    tell process processName
      set w to first window whose name is "PickForge"
      set value of attribute "AXFullScreen" of w to false
    end tell
  end tell
  waitForFullscreen(processName, false)
  delay 0.3
end fullscreenRoundTrip

on waitForFullscreen(processName, expected)
  repeat 50 times
    tell application "System Events"
      tell process processName
        try
          set w to first window whose name is "PickForge"
          if (value of attribute "AXFullScreen" of w) is expected then return
        end try
      end tell
    end tell
    delay 0.1
  end repeat
  error "timed out waiting for fullscreen=" & expected
end waitForFullscreen

on resizeTopEdge(processName)
  tell application "System Events"
    tell process processName
      set w to first window whose name is "PickForge"
      set startPosition to position of w
      set startSize to size of w
      repeat with step from 1 to 8
        set position of w to {(item 1 of startPosition), (item 2 of startPosition) - (step * 4)}
        set size of w to {(item 1 of startSize), (item 2 of startSize) + (step * 4)}
        delay 0.04
      end repeat
    end tell
  end tell
  delay 0.6
end resizeTopEdge

on assertAligned(processName, zoomFactor, stage, reports)
  set baseTitlebarHeight to 38
  set measured to geometry(processName)
  set expectedCenter to (baseTitlebarHeight * zoomFactor) / 2
  set leftInset to item 1 of measured
  set centerInset to item 2 of measured
  set report to (((zoomFactor * 100) as integer) as text) & "% " & stage & ": left=" & (leftInset as text) & " center=" & (centerInset as text)
  set end of reports to report
  if leftInset < 12 or leftInset > 16 or (centerInset - expectedCenter) < -1.5 or (centerInset - expectedCenter) > 1.5 then
    error "traffic lights misaligned: " & report & "; expected left=14±2 center=" & expectedCenter & "±1.5"
  end if
end assertAligned

on geometry(processName)
  tell application "System Events"
    tell process processName
      set w to first window whose name is "PickForge"
      set windowPosition to position of w
      set closeButton to first button of w whose description is "close button"
      set buttonPosition to position of closeButton
      set buttonSize to size of closeButton
      set leftInset to (item 1 of buttonPosition) - (item 1 of windowPosition)
      set centerInset to (item 2 of buttonPosition) - (item 2 of windowPosition) + ((item 2 of buttonSize) / 2)
      return {leftInset, centerInset}
    end tell
  end tell
end geometry

on joinLines(values)
  set AppleScript's text item delimiters to linefeed
  set output to values as text
  set AppleScript's text item delimiters to ""
  return output
end joinLines
