using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;

public static class WaveSink
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public struct WFX
    {
        public ushort wFormatTag; public ushort nChannels; public uint nSamplesPerSec;
        public uint nAvgBytesPerSec; public ushort nBlockAlign; public ushort wBitsPerSample;
        public ushort cbSize;
    }

    [StructLayout(LayoutKind.Explicit, Size = 48)]
    public struct WHDR
    {
        [FieldOffset(0)] public IntPtr lpData;
        [FieldOffset(8)] public uint dwBufferLength;
        [FieldOffset(12)] public uint dwBytesRecorded;
        [FieldOffset(16)] public IntPtr dwUser;
        [FieldOffset(24)] public uint dwFlags;
        [FieldOffset(28)] public uint dwLoops;
        [FieldOffset(32)] public IntPtr lpNext;
        [FieldOffset(40)] public uint reserved;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public struct WAVEOUTCAPS
    {
        public ushort wMid; public ushort wPid; public uint vDriverVersion;
        public uint dwFormats; public ushort wChannels; public ushort wReserved1;
        public uint dwSupport;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szPname;
    }

    public const uint CALLBACK_FUNCTION = 0x00030000;
    public const uint WOM_DONE = 0x3BD;
    public const uint WAVE_FORMAT_PCM = 1;

    [DllImport("winmm.dll", EntryPoint = "waveOutOpen")]
    static extern uint waveOutOpen(out IntPtr hwo, uint uDeviceID, ref WFX pwfx, WaveOutProc cb, IntPtr instance, uint fdwOpen);
    [DllImport("winmm.dll")] static extern uint waveOutClose(IntPtr hwo);
    [DllImport("winmm.dll")] static extern uint waveOutPrepareHeader(IntPtr hwo, ref WHDR pwh, uint cbwh);
    [DllImport("winmm.dll", EntryPoint = "waveOutUnprepareHeader")] static extern uint waveOutUnprepareHeader(IntPtr hwo, ref WHDR pwh, uint cbwh);
    [DllImport("winmm.dll")] static extern uint waveOutWrite(IntPtr hwo, ref WHDR pwh, uint cbwh);
    [DllImport("winmm.dll", EntryPoint = "waveOutGetNumDevs")] static extern uint waveOutGetNumDevs();
    [DllImport("winmm.dll", EntryPoint = "waveOutGetDevCaps", CharSet = CharSet.Ansi)] static extern uint waveOutGetDevCaps(uint uDeviceID, ref WAVEOUTCAPS caps, uint cbwoc);

    delegate void WaveOutProc(IntPtr hwo, uint uMsg, IntPtr inst, IntPtr param1, IntPtr param2);

    sealed class Buf
    {
        public byte[] data;
        public GCHandle dataPin;
        public WHDR hdr;
        public GCHandle hdrPin;
        public IntPtr hdrPtr;
    }

    static readonly object gate = new object();
    static readonly Dictionary<IntPtr, Buf> live = new Dictionary<IntPtr, Buf>();
    static WaveOutProc _cb;

    static void Callback(IntPtr hwo, uint uMsg, IntPtr inst, IntPtr p1, IntPtr p2)
    {
        if (uMsg == WOM_DONE)
        {
            Buf b = null;
            lock (gate) { if (live.TryGetValue(p1, out b)) live.Remove(p1); }
            if (b != null)
            {
                waveOutUnprepareHeader(hwo, ref b.hdr, (uint)Marshal.SizeOf<WHDR>());
                b.dataPin.Free();
                b.hdrPin.Free();
            }
        }
    }

    // Reproduce el flujo hasta EOF de `input`. Devuelve (bytes entregados, bytes descartados).
    public static string Run(Stream input, int rate, int channels, int device)
    {
        WFX fmt = new WFX();
        fmt.wFormatTag = (ushort)WAVE_FORMAT_PCM;
        fmt.nChannels = (ushort)channels;
        fmt.nSamplesPerSec = (uint)rate;
        fmt.wBitsPerSample = 16;
        fmt.nBlockAlign = (ushort)(channels * 2);
        fmt.nAvgBytesPerSec = (uint)(rate * channels * 2);

        if (_cb == null) _cb = new WaveOutProc(Callback);

        IntPtr hwo;
        uint res = waveOutOpen(out hwo, (uint)device, ref fmt, _cb, IntPtr.Zero, CALLBACK_FUNCTION);
        if (res != 0) return "ERR:open:" + res;

        long delivered = 0, dropped = 0;
        byte[] readBuf = new byte[8192];
        try
        {
            while (true)
            {
                int n = input.Read(readBuf, 0, readBuf.Length);
                if (n <= 0) break;
                delivered += n;
                // Si hay demasiados buffers pendientes, dropear el chunk para
                // no inflar la memoria cuando la red va mas rapido que la salida.
                if (live.Count >= 40) { dropped += n; continue; }

                var b = new Buf();
                b.data = new byte[n];
                Array.Copy(readBuf, 0, b.data, 0, n);
                b.dataPin = GCHandle.Alloc(b.data, GCHandleType.Pinned);
                b.hdr.lpData = b.dataPin.AddrOfPinnedObject();
                b.hdr.dwBufferLength = (uint)n;
                b.hdrPin = GCHandle.Alloc(b, GCHandleType.Pinned);
                b.hdrPtr = b.hdrPin.AddrOfPinnedObject();
                waveOutPrepareHeader(hwo, ref b.hdr, (uint)Marshal.SizeOf<WHDR>());
                lock (gate) { live[b.hdrPtr] = b; }
                delivered += n;
                res = waveOutWrite(hwo, ref b.hdr, (uint)Marshal.SizeOf<WHDR>());
            }
        }
        catch { }
        finally
        {
            // Esperar drenaje (max 2 s) y cerrar.
            int waited = 0;
            while (true)
            {
                lock (gate) { if (live.Count == 0) break; }
                if (waited++ > 40) break;
                System.Threading.Thread.Sleep(50);
            }
            waveOutClose(hwo);
        }
        return delivered + ":" + dropped;
    }

    public static string Devices()
    {
        uint n = waveOutGetNumDevs();
        System.Text.StringBuilder sb = new System.Text.StringBuilder();
        for (uint i = 0; i < n; i++)
        {
            WAVEOUTCAPS c = new WAVEOUTCAPS();
            waveOutGetDevCaps(i, ref c, (uint)Marshal.SizeOf<WAVEOUTCAPS>());
            if (i > 0) sb.Append(';');
            sb.Append(i).Append('|').Append(c.szPname);
        }
        return n + ":" + sb.ToString();
    }
}