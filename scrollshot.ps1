Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing
Start-Sleep 2
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
$bitmap.Save("D:/progress project/_screenshot_scroll.png")
$graphics.Dispose(); $bitmap.Dispose()
Write-Host "saved"
