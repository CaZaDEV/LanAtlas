// LanAtlas.exe: llançador de Windows. Executa scripts\launcher.ps1 (que instal·la, compila si cal, engega el
// servidor i obre el navegador) sense mostrar cap finestra de consola, tret del primer cop que ha d'instal·lar.
// Es compila amb scripts\build-launcher.ps1.
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

static class LanAtlasLauncher
{
    [STAThread]
    static int Main(string[] args)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string script = Path.Combine(root, "scripts", "launcher.ps1");
        if (!File.Exists(script))
        {
            MessageBox.Show("No es troba " + script + ".\n\nLanAtlas.exe ha d'estar a la carpeta de LanAtlas.", "LanAtlas", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        // Primer cop (sense node_modules): es mostra la consola per veure el progrés de la instal·lació.
        bool firstRun = !Directory.Exists(Path.Combine(root, "node_modules"));
        var info = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = "-NoProfile -ExecutionPolicy Bypass " + (firstRun ? "" : "-WindowStyle Hidden ") + "-File \"" + script + "\"",
            WorkingDirectory = root,
            UseShellExecute = false,
            CreateNoWindow = !firstRun,
        };
        try
        {
            using (var process = Process.Start(info))
            {
                process.WaitForExit();
                return process.ExitCode;
            }
        }
        catch (Exception error)
        {
            MessageBox.Show("No s'ha pogut engegar PowerShell: " + error.Message, "LanAtlas", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
