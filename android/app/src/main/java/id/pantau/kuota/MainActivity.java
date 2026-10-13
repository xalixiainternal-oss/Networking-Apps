package id.pantau.kuota;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(QuotaPlugin.class);
        registerPlugin(ShizukuPlugin.class);
        registerPlugin(PrankPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
