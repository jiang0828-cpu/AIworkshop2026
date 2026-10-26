// Windows Script Host entry point; no console is created by wscript.exe.
var shell = new ActiveXObject("WScript.Shell");
var fs = new ActiveXObject("Scripting.FileSystemObject");
var scripts = fs.GetParentFolderName(WScript.ScriptFullName);
var root = fs.GetParentFolderName(scripts);
shell.CurrentDirectory = root;
var powershell = shell.ExpandEnvironmentStrings("%SystemRoot%") + "\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
var command = '"' + powershell + '" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + scripts + '\\ensure-local-scheduler.ps1"';
var exitCode = 1;
try {
    exitCode = shell.Run(command, 0, true);
} finally {
    var log = fs.OpenTextFile(root + "\\data\\local-scheduler-launcher.log", 8, true);
    log.WriteLine(new Date().toUTCString() + " host=wscript hidden=true exit=" + exitCode);
    log.Close();
}
WScript.Quit(exitCode);
