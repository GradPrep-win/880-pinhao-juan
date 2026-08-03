Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing
Start-Sleep -Seconds 3
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
$bitmap.Save("D:/progress project/_screenshot_check2.png")
$graphics.Dispose(); $bitmap.Dispose()
Write-Host "saved"
