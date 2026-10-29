package com.kiragaming.kiraautopost.data

import com.kiragaming.kiraautopost.model.PostMedia

/** In-memory draft of the selected photos/files so they survive switching tabs. */
object PostDraft {
    var media: List<PostMedia> = emptyList()
}
