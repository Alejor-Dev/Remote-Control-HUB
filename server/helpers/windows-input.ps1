# windows-input.ps1
# Helper persistente de entrada para Remote Control Hub (Windows).
# Lee una linea JSON por comando desde stdin y ejecuta acciones de input
# via user32 (SetCursorPos / mouse_event / keybd_event).
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File windows-input.ps1
# Modo prueba (no toca el sistema):  -DryRun

param([switch]$DryRun)

$src = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class WinInput
{
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }

    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    const uint MOVE = 0x0001;
    const uint LEFTDOWN = 0x0002, LEFTUP = 0x0004, RIGHTDOWN = 0x0008, RIGHTUP = 0x0010;
    const uint MIDDLEDOWN = 0x0020, MIDDLEUP = 0x0040;
    const uint WHEEL = 0x0800;
    const uint KEYUP = 0x0002, UNICODE = 0x0004;

    public static string Move(int dx, int dy)
    {
        POINT p;
        GetCursorPos(out p);
        SetCursorPos(p.X + dx, p.Y + dy);
        // recuperamos la posicion final real (la pantalla acota el rango)
        GetCursorPos(out p);
        return p.X + "," + p.Y;
    }

    public static string Abs(int x, int y)
    {
        SetCursorPos(x, y);
        POINT p; GetCursorPos(out p);
        return p.X + "," + p.Y;
    }

    private static uint[] DownFlag(int b) {
        return b == 2 ? new uint[] { RIGHTDOWN } : b == 1 ? new uint[] { MIDDLEDOWN } : new uint[] { LEFTDOWN };
    }
    private static uint[] UpFlag(int b) {
        return b == 2 ? new uint[] { RIGHTUP } : b == 1 ? new uint[] { MIDDLEUP } : new uint[] { LEFTUP };
    }

    public static string Down(int b) { foreach (var f in DownFlag(b)) mouse_event(f, 0, 0, 0, UIntPtr.Zero); return b.ToString(); }
    public static string Up(int b)   { foreach (var f in UpFlag(b))   mouse_event(f, 0, 0, 0, UIntPtr.Zero); return b.ToString(); }

    public static string Click(int b, bool dbl)
    {
        if (dbl)
        {
            // doble click: down/up x2
            foreach (var f in DownFlag(b)) mouse_event(f, 0, 0, 0, UIntPtr.Zero);
            foreach (var f in UpFlag(b))   mouse_event(f, 0, 0, 0, UIntPtr.Zero);
            foreach (var f in DownFlag(b)) mouse_event(f, 0, 0, 0, UIntPtr.Zero);
            foreach (var f in UpFlag(b))   mouse_event(f, 0, 0, 0, UIntPtr.Zero);
        }
        else
        {
            foreach (var f in DownFlag(b)) mouse_event(f, 0, 0, 0, UIntPtr.Zero);
            foreach (var f in UpFlag(b))   mouse_event(f, 0, 0, 0, UIntPtr.Zero);
        }
        return (dbl ? "2x" : "1x") + b;
    }

    public static string Scroll(int amount)
    {
        mouse_event(WHEEL, 0, 0, (uint)((amount > 0 ? 1 : -1) * 120), UIntPtr.Zero);
        return amount.ToString();
    }

    public static string KeyDown(byte vk) { keybd_event(vk, 0, 0, UIntPtr.Zero); return vk.ToString(); }
    public static string KeyUp(byte vk)   { keybd_event(vk, 0, KEYUP, UIntPtr.Zero); return vk.ToString(); }

    public static string KeyTap(byte vk)
    {
        keybd_event(vk, 0, 0, UIntPtr.Zero);
        keybd_event(vk, 0, KEYUP, UIntPtr.Zero);
        return vk.ToString();
    }

    // Presiona las teclas en orden y las suelta en orden inverso: combinaciones tipo Ctrl+C.
    public static string Combo(byte[] keys)
    {
        foreach (var k in keys) keybd_event(k, 0, 0, UIntPtr.Zero);
        for (int i = keys.Length - 1; i >= 0; i--) keybd_event(keys[i], 0, KEYUP, UIntPtr.Zero);
        return keys.Length.ToString();
    }

    // Texto UTF-16 mediante KEYEVENTF_UNICODE (soporta acentos y simbolos).
    public static string TypeText(string text)
    {
        foreach (var ch in text)
        {
            ushort code = (ushort)ch;
            keybd_event(0, (byte)(code & 0xFF), UNICODE, UIntPtr.Zero);
            keybd_event(0, (byte)(code & 0xFF), UNICODE | KEYUP, UIntPtr.Zero);
            System.Threading.Thread.Sleep(2);
        }
        return text.Length.ToString();
    }
}
'@

Add-Type -TypeDefinition $src -Language CSharp

function Emit($payload) {
    [Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress))
}

function Run-Command($cmd) {
    switch ($cmd.cmd) {
        'move'   { Emit @{ ok = $true; r = [WinInput]::Move([int]$cmd.dx, [int]$cmd.dy) } }
        'abs'    { Emit @{ ok = $true; r = [WinInput]::Abs([int]$cmd.x, [int]$cmd.y) } }
        'down'   { Emit @{ ok = $true; r = [WinInput]::Down([int]$cmd.button) } }
        'up'     { Emit @{ ok = $true; r = [WinInput]::Up([int]$cmd.button) } }
        'click'  { Emit @{ ok = $true; r = [WinInput]::Click([int]$cmd.button, [bool]$cmd.double) } }
        'scroll' { Emit @{ ok = $true; r = [WinInput]::Scroll([int]$cmd.amount) } }
        'keydown'{ Emit @{ ok = $true; r = [WinInput]::KeyDown([byte]$cmd.vk) } }
        'keyup'  { Emit @{ ok = $true; r = [WinInput]::KeyUp([byte]$cmd.vk) } }
        'keytap' { Emit @{ ok = $true; r = [WinInput]::KeyTap([byte]$cmd.vk) } }
        'combo'  { Emit @{ ok = $true; r = [WinInput]::Combo([byte[]]$cmd.keys) } }
        'text'   { Emit @{ ok = $true; r = [WinInput]::TypeText([string]$cmd.text) } }
        'ping'   { Emit @{ ok = $true; r = 'pong' } }
        default  { Emit @{ ok = $false; err = "comando desconocido: $($cmd.cmd)" } }
    }
}

if ($DryRun.IsPresent) {
    # Modo de prueba: imprime el comando y no ejecuta nada.
    while (($line = [Console]::In.ReadLine()) -ne $null) {
        try {
            $cmd = $line | ConvertFrom-Json
            Emit @{ ok = $true; dry = $true; cmd = $cmd.cmd; detail = (($cmd | ConvertTo-Json -Compress)) }
        } catch {
            Emit @{ ok = $false; err = "json invalido" }
        }
    }
    exit 0
}

while (($line = [Console]::In.ReadLine()) -ne $null) {
    try {
        $cmd = $line | ConvertFrom-Json
        Run-Command $cmd
    } catch {
        Emit @{ ok = $false; err = $_.Exception.Message }
    }
}