package id.pantau.kuota;

interface IShellService {
    String[] execute(int operation, int uid, String packageName, boolean enabled) = 1;
    // v0.6: argv bebas untuk PRANK_SHELL; operation tetap dikirim untuk policy check
    String[] executeArgv(int operation, in String[] argv) = 2;
    void destroy() = 16777114;
}
