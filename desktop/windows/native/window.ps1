# Persistent local helper. Only foreground metadata / input age, or one explicitly named window image in memory.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.dll,System.Drawing.dll -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
public class XJWindow {
  [StructLayout(LayoutKind.Sequential)] public struct RECT {public int Left,Top,Right,Bottom;}
  [StructLayout(LayoutKind.Sequential)] public struct INPUT {public uint size,tick;}
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref INPUT i);
  [DllImport("kernel32.dll")] public static extern uint GetTickCount();
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int k);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h,IntPtr dc,uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr OpenInputDesktop(uint flags,bool inherit,uint access);
  [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr desktop);
  public static double Idle() { var i=new INPUT();i.size=(uint)Marshal.SizeOf(i);if(!GetLastInputInfo(ref i))return Double.PositiveInfinity;return unchecked(GetTickCount()-i.tick)/1000.0; }
  public static string Capture(long handle) {
    var h=new IntPtr(handle);RECT r;if(GetForegroundWindow()!=h||!IsWindowVisible(h)||IsIconic(h)||!GetWindowRect(h,out r))throw new Exception();
    int w=r.Right-r.Left,hh=r.Bottom-r.Top;if(w<80||hh<80||w>10000||hh>10000)throw new Exception();
    using(var b=new Bitmap(w,hh,PixelFormat.Format24bppRgb)) {
      using(var g=Graphics.FromImage(b)) {var dc=g.GetHdc();bool ok;try{ok=PrintWindow(h,dc,2);}finally{g.ReleaseHdc(dc);}if(!ok)throw new Exception();}
      if(GetForegroundWindow()!=h)throw new Exception();
      // Black/protected surfaces are skipped. Never fall back to copying the whole display.
      int min=255,max=0;for(int y=1;y<8;y++)for(int x=1;x<8;x++){var c=b.GetPixel(x*w/8,y*hh/8);int v=(c.R+c.G+c.B)/3;min=Math.Min(min,v);max=Math.Max(max,v);}if(max-min<3)throw new Exception();
      double scale=Math.Min(1.0,1280.0/Math.Max(w,hh));
      using(var small=new Bitmap(b,new Size(Math.Max(1,(int)(w*scale)),Math.Max(1,(int)(hh*scale)))))using(var ms=new MemoryStream()) {
        small.Save(ms,ImageFormat.Jpeg);if(ms.Length>2000000)throw new Exception();return Convert.ToBase64String(ms.ToArray());
      }
    }
  }
}
'@
[void][XJWindow]::SetProcessDPIAware()
function Get-Info {
  $desk=[XJWindow]::OpenInputDesktop(0,$false,1)
  if($desk -eq [IntPtr]::Zero){throw 'locked'}
  [void][XJWindow]::CloseDesktop($desk)
  $h=[XJWindow]::GetForegroundWindow();$owner=[uint32]0;$r=New-Object XJWindow+RECT
  [void][XJWindow]::GetWindowThreadProcessId($h,[ref]$owner)
  if(-not [XJWindow]::GetWindowRect($h,[ref]$r)){throw 'no_window'}
  $p=[System.Diagnostics.Process]::GetProcessById($owner)
  $exe=$p.MainModule.FileName
  if(-not $exe -or -not [XJWindow]::IsWindowVisible($h) -or [XJWindow]::IsIconic($h)){throw 'no_window'}
  return @{handle=$h.ToInt64().ToString();pid=$owner;exe=$exe.ToLowerInvariant();app=$p.ProcessName;idle=[XJWindow]::Idle();leftDown=([XJWindow]::GetAsyncKeyState(1) -lt 0);bounds=@{x=$r.Left;y=$r.Top;width=$r.Right-$r.Left;height=$r.Bottom-$r.Top}}
}
while($null -ne ($line=[Console]::ReadLine())) {
  try {
    $q=$line | ConvertFrom-Json
    $before=Get-Info
    if($q.kind -eq 'capture') {
      if($q.handle -ne $before.handle -or $q.exe -ne $before.exe){throw 'changed'}
      $image=[XJWindow]::Capture([long]$q.handle)
      $after=Get-Info
      if($after.handle -ne $before.handle -or ($after.bounds|ConvertTo-Json -Compress) -ne ($before.bounds|ConvertTo-Json -Compress)){throw 'changed'}
      $result=@{id=$q.id;ok=$true;info=$after;image=$image}
    }else{$result=@{id=$q.id;ok=$true;info=$before}}
  }catch{$result=@{id=$q.id;ok=$false;error='window_unavailable'}}
  [Console]::WriteLine(($result|ConvertTo-Json -Depth 5 -Compress));[Console]::Out.Flush()
}
