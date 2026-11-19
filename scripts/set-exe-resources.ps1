# exe の資源を書き換える。アイコン（RT_GROUP_ICON / RT_ICON）を ICO ファイルの中身で置き換え、
# バージョン情報（RT_VERSION）の名前と版を OuiP のものにする。タスクマネージャーやエクスプローラーはここを読む。
# Windows 標準の BeginUpdateResource / UpdateResource / EndUpdateResource を使い、追加の依存を持たない。
# 使い方:
#   -Exe <OuiP.exe> -Ico <OuiP.ico>               アイコンを置き換える
#   -Exe <OuiP.exe> -Name OuiP -Version 0.4.0     名前と版を書き換える（会社名・著作権表示は Electron のまま）
#   -Exe <OuiP.exe> -ListOnly                     アイコンのグループと、バージョン情報の文字列を出す
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [string]$Ico,
  [string]$Name,
  [string]$Version,
  [switch]$ListOnly
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class OuipExeIcon {
  const uint LOAD_LIBRARY_AS_DATAFILE = 0x2;
  const uint LOAD_LIBRARY_AS_IMAGE_RESOURCE = 0x20;
  static readonly IntPtr RT_ICON = (IntPtr)3;
  static readonly IntPtr RT_GROUP_ICON = (IntPtr)14;
  static readonly IntPtr RT_VERSION = (IntPtr)16;

  [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr LoadLibraryEx(string path, IntPtr file, uint flags);
  [DllImport("kernel32", SetLastError = true)] static extern bool FreeLibrary(IntPtr h);
  delegate bool EnumNameProc(IntPtr h, IntPtr type, IntPtr name, IntPtr param);
  delegate bool EnumLangProc(IntPtr h, IntPtr type, IntPtr name, ushort lang, IntPtr param);
  [DllImport("kernel32", SetLastError = true)] static extern bool EnumResourceNames(IntPtr h, IntPtr type, EnumNameProc proc, IntPtr param);
  [DllImport("kernel32", SetLastError = true)] static extern bool EnumResourceLanguages(IntPtr h, IntPtr type, IntPtr name, EnumLangProc proc, IntPtr param);
  [DllImport("kernel32", SetLastError = true)] static extern IntPtr FindResourceEx(IntPtr h, IntPtr type, IntPtr name, ushort lang);
  [DllImport("kernel32", SetLastError = true)] static extern IntPtr LoadResource(IntPtr h, IntPtr res);
  [DllImport("kernel32", SetLastError = true)] static extern IntPtr LockResource(IntPtr data);
  [DllImport("kernel32", SetLastError = true)] static extern uint SizeofResource(IntPtr h, IntPtr res);
  [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr BeginUpdateResource(string path, bool deleteExisting);
  [DllImport("kernel32", SetLastError = true)] static extern bool UpdateResource(IntPtr h, IntPtr type, IntPtr name, ushort lang, byte[] data, uint size);
  [DllImport("kernel32", SetLastError = true)] static extern bool EndUpdateResource(IntPtr h, bool discard);

  static bool IsIntResource(IntPtr p) { return ((ulong)p.ToInt64() >> 16) == 0; }

  // 種類 type の資源を（名前, 言語）の組で列挙する。名前付きの資源は扱わない。
  static List<KeyValuePair<ushort, ushort>> Entries(IntPtr h, IntPtr type) {
    var names = new List<IntPtr>();
    EnumResourceNames(h, type, (m, t, n, p) => {
      if (!IsIntResource(n)) throw new Exception("named resource is not supported");
      names.Add(n); return true;
    }, IntPtr.Zero);
    var found = new List<KeyValuePair<ushort, ushort>>();
    foreach (var n in names) {
      EnumResourceLanguages(h, type, n, (m, t, nm, l, p) => { found.Add(new KeyValuePair<ushort, ushort>((ushort)n.ToInt64(), l)); return true; }, IntPtr.Zero);
    }
    return found;
  }

  static byte[] ReadData(IntPtr h, IntPtr type, ushort name, ushort lang) {
    IntPtr r = FindResourceEx(h, type, (IntPtr)name, lang);
    uint size = SizeofResource(h, r);
    byte[] data = new byte[size];
    Marshal.Copy(LockResource(LoadResource(h, r)), data, 0, (int)size);
    return data;
  }

  static IntPtr Open(string exe) {
    IntPtr h = LoadLibraryEx(exe, IntPtr.Zero, LOAD_LIBRARY_AS_DATAFILE | LOAD_LIBRARY_AS_IMAGE_RESOURCE);
    if (h == IntPtr.Zero) throw new Exception("LoadLibraryEx failed: " + Marshal.GetLastWin32Error());
    return h;
  }

  // ---- アイコン ----

  public class Group { public ushort Name; public ushort Lang; public List<ushort> IconIds = new List<ushort>(); }

  public static List<Group> ListGroups(string exe) {
    IntPtr h = Open(exe);
    var groups = new List<Group>();
    try {
      foreach (var e in Entries(h, RT_GROUP_ICON)) {
        var g = new Group { Name = e.Key, Lang = e.Value };
        byte[] data = ReadData(h, RT_GROUP_ICON, e.Key, e.Value);
        int count = BitConverter.ToUInt16(data, 4);
        for (int i = 0; i < count; i++) g.IconIds.Add(BitConverter.ToUInt16(data, 6 + i * 14 + 12));
        groups.Add(g);
      }
    } finally { FreeLibrary(h); }
    return groups;
  }

  // 先頭のグループ（エクスプローラーが使うもの）を ICO の全サイズで置き換える。他のグループは触らない。
  public static string Replace(string exe, string ico) {
    var groups = ListGroups(exe);
    if (groups.Count == 0) throw new Exception("no RT_GROUP_ICON in exe");
    groups.Sort((a, b) => a.Name.CompareTo(b.Name));
    var first = groups[0];
    var used = new HashSet<ushort>();
    foreach (var g in groups) if (g.Name != first.Name) foreach (var id in g.IconIds) used.Add(id);

    byte[] icoBytes = File.ReadAllBytes(ico);
    if (BitConverter.ToUInt16(icoBytes, 0) != 0 || BitConverter.ToUInt16(icoBytes, 2) != 1) throw new Exception("not an ICO file");
    int n = BitConverter.ToUInt16(icoBytes, 4);
    if (n == 0) throw new Exception("ICO has no images");

    var newIds = new List<ushort>();
    ushort next = 1;
    for (int i = 0; i < n; i++) { while (used.Contains(next)) next++; newIds.Add(next); used.Add(next); next++; }

    IntPtr hu = BeginUpdateResource(exe, false);
    if (hu == IntPtr.Zero) throw new Exception("BeginUpdateResource failed: " + Marshal.GetLastWin32Error());
    bool ok = false;
    try {
      foreach (var g in groups) {
        if (g.Name != first.Name) continue;
        foreach (var id in g.IconIds) UpdateResource(hu, RT_ICON, (IntPtr)id, g.Lang, null, 0);
      }
      var grp = new MemoryStream();
      var w = new BinaryWriter(grp);
      w.Write((ushort)0); w.Write((ushort)1); w.Write((ushort)n);
      for (int i = 0; i < n; i++) {
        int e = 6 + i * 16;
        int bytes = BitConverter.ToInt32(icoBytes, e + 8);
        int offset = BitConverter.ToInt32(icoBytes, e + 12);
        byte[] img = new byte[bytes];
        Array.Copy(icoBytes, offset, img, 0, bytes);
        if (!UpdateResource(hu, RT_ICON, (IntPtr)newIds[i], first.Lang, img, (uint)img.Length)) throw new Exception("UpdateResource RT_ICON failed: " + Marshal.GetLastWin32Error());
        w.Write(icoBytes, e, 12);           // 幅・高さ・色数・予約・面・ビット数・サイズ
        w.Write(newIds[i]);
      }
      byte[] grpBytes = grp.ToArray();
      if (!UpdateResource(hu, RT_GROUP_ICON, (IntPtr)first.Name, first.Lang, grpBytes, (uint)grpBytes.Length)) throw new Exception("UpdateResource RT_GROUP_ICON failed: " + Marshal.GetLastWin32Error());
      ok = true;
    } finally {
      if (!EndUpdateResource(hu, !ok) && ok) throw new Exception("EndUpdateResource failed: " + Marshal.GetLastWin32Error());
    }
    return "group " + first.Name + " lang " + first.Lang + " icons " + n;
  }

  // ---- バージョン情報 ----

  // VS_VERSIONINFO の1つの節。wLength・wValueLength・wType・szKey・Value・子の節からなり、各所が4バイト境界にそろう。
  public class VNode { public string Key; public ushort Type; public byte[] Value = new byte[0]; public List<VNode> Children = new List<VNode>(); }

  static int Align4(int n) { return (n + 3) & ~3; }

  static VNode Parse(byte[] d, int at, out int end) {
    int len = BitConverter.ToUInt16(d, at), vlen = BitConverter.ToUInt16(d, at + 2);
    var node = new VNode { Type = BitConverter.ToUInt16(d, at + 4) };
    int p = at + 6, k = p;
    while (BitConverter.ToUInt16(d, k) != 0) k += 2;
    node.Key = Encoding.Unicode.GetString(d, p, k - p);
    p = Align4(k + 2);
    int vbytes = node.Type == 1 ? vlen * 2 : vlen;   // 文字列の値は文字数（終端を含む）で数える
    if (p + vbytes > at + len) vbytes = Math.Max(0, at + len - p);
    node.Value = new byte[vbytes];
    Array.Copy(d, p, node.Value, 0, vbytes);
    p = Align4(p + vbytes);
    end = at + len;
    while (p < end) { int e; node.Children.Add(Parse(d, p, out e)); p = Align4(e); }
    return node;
  }

  static byte[] Build(VNode n) {
    var ms = new MemoryStream(); var w = new BinaryWriter(ms);
    w.Write((ushort)0); w.Write((ushort)0); w.Write(n.Type);
    w.Write(Encoding.Unicode.GetBytes(n.Key + "\0"));
    while (ms.Length % 4 != 0) w.Write((byte)0);
    w.Write(n.Value);
    foreach (var c in n.Children) { while (ms.Length % 4 != 0) w.Write((byte)0); w.Write(Build(c)); }
    byte[] b = ms.ToArray();
    BitConverter.GetBytes((ushort)b.Length).CopyTo(b, 0);
    ushort vlen = (ushort)(n.Type == 1 ? n.Value.Length / 2 : n.Value.Length);
    BitConverter.GetBytes(vlen).CopyTo(b, 2);
    return b;
  }

  static VNode ReadVersion(string exe, out ushort name, out ushort lang) {
    IntPtr h = Open(exe);
    try {
      var found = Entries(h, RT_VERSION);
      if (found.Count != 1) throw new Exception("expected one RT_VERSION, found " + found.Count);
      name = found[0].Key; lang = found[0].Value;
      int end;
      return Parse(ReadData(h, RT_VERSION, name, lang), 0, out end);
    } finally { FreeLibrary(h); }
  }

  static string Str(byte[] v) { var s = Encoding.Unicode.GetString(v); int z = s.IndexOf('\0'); return z >= 0 ? s.Substring(0, z) : s; }

  public static List<string> ListVersion(string exe) {
    ushort name, lang;
    var root = ReadVersion(exe, out name, out lang);
    var lines = new List<string>();
    foreach (var sfi in root.Children) if (sfi.Key == "StringFileInfo")
      foreach (var table in sfi.Children) foreach (var kv in table.Children) lines.Add(kv.Key + "=" + Str(kv.Value));
    var f = root.Value;
    if (f.Length >= 52) {
      uint ms = BitConverter.ToUInt32(f, 8), ls = BitConverter.ToUInt32(f, 12);
      lines.Add("FixedFileVersion=" + (ms >> 16) + "." + (ms & 0xFFFF) + "." + (ls >> 16) + "." + (ls & 0xFFFF));
    }
    return lines;
  }

  // 名前（FileDescription・ProductName・InternalName・OriginalFilename）と版（文字列と固定値）を書き換える。
  // CompanyName・LegalCopyright は exe の中身（Electron）の表示なので変えない。
  public static string SetVersion(string exe, string product, string version) {
    var parts = version.Split('.');
    if (parts.Length != 3) throw new Exception("version must be x.y.z: " + version);
    ushort[] num = new ushort[4];
    for (int i = 0; i < 3; i++) num[i] = ushort.Parse(parts[i]);
    ushort name, lang;
    var root = ReadVersion(exe, out name, out lang);
    if (root.Key != "VS_VERSION_INFO" || root.Value.Length < 52) throw new Exception("unexpected VS_VERSIONINFO");
    var values = new Dictionary<string, string> {
      { "FileDescription", product }, { "ProductName", product },
      { "InternalName", product }, { "OriginalFilename", product + ".exe" },
      { "FileVersion", version }, { "ProductVersion", version },
    };
    var changed = new HashSet<string>();
    foreach (var sfi in root.Children) if (sfi.Key == "StringFileInfo")
      foreach (var table in sfi.Children) foreach (var kv in table.Children)
        if (values.ContainsKey(kv.Key)) { kv.Value = Encoding.Unicode.GetBytes(values[kv.Key] + "\0"); kv.Type = 1; changed.Add(kv.Key); }
    if (changed.Count != values.Count) throw new Exception("expected " + values.Count + " strings, changed " + changed.Count);
    uint msv = ((uint)num[0] << 16) | num[1], lsv = ((uint)num[2] << 16) | num[3];
    foreach (int off in new[] { 8, 16 }) { BitConverter.GetBytes(msv).CopyTo(root.Value, off); BitConverter.GetBytes(lsv).CopyTo(root.Value, off + 4); }
    byte[] data = Build(root);
    IntPtr hu = BeginUpdateResource(exe, false);
    if (hu == IntPtr.Zero) throw new Exception("BeginUpdateResource failed: " + Marshal.GetLastWin32Error());
    bool ok = UpdateResource(hu, RT_VERSION, (IntPtr)name, lang, data, (uint)data.Length);
    int err = Marshal.GetLastWin32Error();
    if (!EndUpdateResource(hu, !ok) || !ok) throw new Exception("RT_VERSION update failed: " + err);
    return "version " + product + " " + version;
  }
}
'@

$exePath = (Resolve-Path -LiteralPath $Exe).Path
if ($ListOnly) {
  foreach ($g in [OuipExeIcon]::ListGroups($exePath)) { "group $($g.Name) lang $($g.Lang) icons $($g.IconIds -join ',')" }
  foreach ($line in [OuipExeIcon]::ListVersion($exePath)) { "version $line" }
  exit 0
}
if (-not $Ico -and -not $Name) { throw '-Ico or -Name is required' }
if ($Ico) { [OuipExeIcon]::Replace($exePath, (Resolve-Path -LiteralPath $Ico).Path) }
if ($Name) {
  if (-not $Version) { throw '-Version is required with -Name' }
  [OuipExeIcon]::SetVersion($exePath, $Name, $Version)
}
