package io.github.nosugark.scankick

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val content = findViewById<View>(android.R.id.content)
        ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
            val types = WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            val safe = insets.getInsets(types)
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
            // The native container owns these insets; keep IME insets for the WebView.
            WindowInsetsCompat.Builder(insets)
                .setInsets(types, Insets.NONE)
                .setInsetsIgnoringVisibility(types, Insets.NONE)
                .setDisplayCutout(null)
                .build()
        }
        ViewCompat.requestApplyInsets(content)
    }
}
