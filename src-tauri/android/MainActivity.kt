package network.requant.wallet

import android.os.Bundle
import android.view.WindowManager

class MainActivity : TauriActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // Protect the first WebView frame and every recovery/backup flow.
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        super.onCreate(savedInstanceState)
    }
}
