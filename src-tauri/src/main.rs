// Keep Windows release launches free of an auxiliary console window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    shiqu_desktop::run();
}
