// Resolve ambiguity between System.Windows.Application (WPF) and
// System.Windows.Forms.Application (WinForms, needed for NotifyIcon).
// This global alias makes bare "Application" always refer to WPF throughout the project.
global using Application = System.Windows.Application;
