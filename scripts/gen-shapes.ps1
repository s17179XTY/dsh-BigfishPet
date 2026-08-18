# Regenerate pet-shapes.json from assets/pet/*.png (row-scan alpha>threshold,
# vertical merge of identical segments). Implemented in C# to avoid
# PowerShell collection quirks.
Add-Type -AssemblyName System.Drawing
$cs = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Collections.Generic;
using System.Text;

public static class ShapeGen {
  // PNG IHDR: bytes 16..19 = width, 20..23 = height (big-endian)
  private static int[] PngSize(string file) {
    using (var fs = System.IO.File.OpenRead(file)) {
      var head = new byte[24];
      int n = fs.Read(head, 0, 24);
      if (n < 24) return new[] { 0, 0 };
      int w = (head[16] << 24) | (head[17] << 16) | (head[18] << 8) | head[19];
      int h = (head[20] << 24) | (head[21] << 16) | (head[22] << 8) | head[23];
      return new[] { w, h };
    }
  }

  public static string Generate(string dir, int threshold, out int[] perFrame) {
    var files = System.IO.Directory.GetFiles(dir, "*.png");
    Array.Sort(files);
    perFrame = new int[files.Length];
    var sb = new StringBuilder();
    sb.Append('{');
    for (int fi = 0; fi < files.Length; fi++) {
      var bmp = new Bitmap(files[fi]);
      int w = bmp.Width, h = bmp.Height;
      int[] orig = PngSize(files[fi]);
      // The shapes live in a "height normalized to 160" space, matching the
      // contain-mapping in applyPetShape(): scale = min(box/meta.w, box/160).
      double norm = 160.0 / orig[1];
      int metaW = (int)Math.Round(orig[0] * norm);
      var rc = new Rectangle(0, 0, w, h);
      var data = bmp.LockBits(rc, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
      var bytes = new byte[data.Stride * h];
      System.Runtime.InteropServices.Marshal.Copy(data.Scan0, bytes, 0, bytes.Length);
      bmp.UnlockBits(data);
      bmp.Dispose();

      var rects = new List<int[]>();
      var active = new Dictionary<string, int>();
      for (int y = 0; y < h; y++) {
        var rowKeys = new HashSet<string>();
        int x = 0;
        int stride = data.Stride;
        while (x < w) {
          if (bytes[y * stride + x * 4 + 3] > threshold) {
            int start = x;
            while (x < w && bytes[y * stride + x * 4 + 3] > threshold) x++;
            rowKeys.Add(start + ":" + (x - start));
          } else {
            x++;
          }
        }
        var next = new Dictionary<string, int>();
        foreach (var k in rowKeys) {
          int ay;
          if (active.TryGetValue(k, out ay)) { next[k] = ay; }
          else { next[k] = y; }
        }
        foreach (var kv in active) {
          if (!rowKeys.Contains(kv.Key)) {
            var p = kv.Key.Split(':');
            rects.Add(new[] { int.Parse(p[0]), kv.Value, int.Parse(p[1]), y - kv.Value });
          }
        }
        active = next;
      }
      foreach (var kv in active) {
        var p = kv.Key.Split(':');
        rects.Add(new[] { int.Parse(p[0]), kv.Value, int.Parse(p[1]), h - kv.Value });
      }

      string name = System.IO.Path.GetFileName(files[fi]);
      if (fi > 0) sb.Append(',');
      sb.Append('"').Append(name).Append("\":{\"w\":").Append(metaW).Append(",\"rects\":[");
      for (int i = 0; i < rects.Count; i++) {
        if (i > 0) sb.Append(',');
        var r = rects[i];
        int rx = (int)Math.Round(r[0] * norm);
        int ry = (int)Math.Round(r[1] * norm);
        int rw = Math.Max(1, (int)Math.Round(r[2] * norm));
        int rh = Math.Max(1, (int)Math.Round(r[3] * norm));
        sb.Append('[').Append(rx).Append(',').Append(ry).Append(',').Append(rw).Append(',').Append(rh).Append(']');
      }
      sb.Append("]}");
      perFrame[fi] = rects.Count;
    }
    sb.Append('}');
    return sb.ToString();
  }
}
'@
Add-Type -TypeDefinition $cs -ReferencedAssemblies System.Drawing

$srcDir = Join-Path $PWD 'bigfish\assets\pet'
$dst = Join-Path $PWD 'bigfish\pet-shapes.json'
$json = [ShapeGen]::Generate($srcDir, 200, [ref]$null)
[System.IO.File]::WriteAllText($dst, $json, (New-Object System.Text.UTF8Encoding $false))

# quick verification: frame keys + rect counts
$data = Get-Content $dst -Raw | ConvertFrom-Json
$frames = @('idle.png','eat-1.png','eat-2.png','eat-3.png','eat-4.png','sleep.png','walk-left-1.png','walk-left-2.png','walk-right-1.png','walk-right-2.png')
foreach ($f in $frames) {
  if ($null -eq $data.$f) { Write-Host "MISSING: $f"; continue }
  $area = 0
  foreach ($r in $data.$f.rects) { $area += $r[2] * $r[3] }
  Write-Host ("{0,-18} w={1,-4} rects={2,-5} coverage={3}%" -f $f, $data.$f.w, $data.$f.rects.Count, [math]::Round($area / ($data.$f.w * 160) * 100))
}
Write-Host "written: $dst ($((Get-Item $dst).Length) bytes)"
