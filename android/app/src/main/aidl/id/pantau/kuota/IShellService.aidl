package id.pantau.kuota;

interface IShellService {
    String[] execute(int operation, int uid, String packageName, boolean enabled) = 1;
    void destroy() = 16777114;
}