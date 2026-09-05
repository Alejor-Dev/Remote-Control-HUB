# windows-audio.ps1
# Helper de audio de Remote Control Hub (Windows).
# Lee PCM crudo de 16 bits (little-endian) desde stdin y lo reproduce por un
# dispositivo waveOut, o lo vuelca a un archivo si se usa -DryRun.
#
# Uso normal : powershell -File windows-audio.ps1 -Rate 48000 -Channels 1 -Device -1 -Assembly wavesink.dll
# Modo prueba: powershell -File windows-audio.ps1 -DryRun -OutFile capture.raw ...
# Listar dispositivos: powershell -File windows-audio.ps1 -ListDevices
#
# IMPORTANTE: el codigo C# se compila UNA vez desde Node a una DLL
# (helpers/wavesink.cs -> data/wavesink.dll via csc.exe) y aqui solo se CARGA
# con Add-Type -Path. Usar Add-Type -TypeDefinition (compilar con csc.exe) con
# el stdin redirigido corrompe el manejador de stdin del proceso y
# [Console]::OpenStandardInput() lee EOF al instante.

param(
    [int]$Rate = 48000,
    [int]$Channels = 1,
    [int]$Device = -1,
    [switch]$DryRun,
    [string]$OutFile,
    [string]$Assembly,
    [switch]$ListDevices
)

if ($DryRun.IsPresent) {
    if ([string]::IsNullOrEmpty($OutFile)) { Write-Error "OutFile required in DryRun"; exit 1 }
    $inputStream = [Console]::OpenStandardInput()
    $fs = [System.IO.File]::Open($OutFile, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
    $reader = New-Object System.IO.BinaryReader($inputStream)
    $buf = New-Object byte[] 16384
    try {
        while ($true) {
            $n = $reader.Read($buf, 0, $buf.Length)
            if ($n -le 0) { break }
            $fs.Write($buf, 0, $n)
        }
    } finally {
        $fs.Flush()
        $fs.Close()
    }
    Write-Output "captured"
    exit 0
}

if ([string]::IsNullOrEmpty($Assembly)) { Write-Error "Assembly required in playback mode"; exit 1 }
Add-Type -Path $Assembly

$inputStream = [Console]::OpenStandardInput()

if ($ListDevices.IsPresent) {
    [Console]::Out.WriteLine([WaveSink]::Devices())
    exit 0
}

$result = [WaveSink]::Run($inputStream, $Rate, $Channels, $Device)
Write-Output $result