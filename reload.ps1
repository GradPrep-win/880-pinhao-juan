Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
# send Ctrl+R to electron to reload
[System.Windows.Forms.SendKeys]::SendWait("^r")
Start-Sleep -1
Write-Host "sent reload"
