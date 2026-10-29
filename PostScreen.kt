package com.kiragaming.kiraautopost.ui.screens

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.kiragaming.kiraautopost.R
import com.kiragaming.kiraautopost.data.AccountStore
import com.kiragaming.kiraautopost.data.GroupStore
import com.kiragaming.kiraautopost.data.PostDraft
import com.kiragaming.kiraautopost.data.PreferencesManager
import com.kiragaming.kiraautopost.engine.PostingManager
import com.kiragaming.kiraautopost.model.ChatGroup
import com.kiragaming.kiraautopost.model.MediaType
import com.kiragaming.kiraautopost.model.PostMedia
import com.kiragaming.kiraautopost.ui.theme.*
import java.io.File
import java.io.FileOutputStream

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PostScreen(
    accountStore: AccountStore,
    groupStore: GroupStore,
    prefs: PreferencesManager,
    postingManager: PostingManager,
    onNavigateToReports: () -> Unit
) {
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    val accounts = remember { accountStore.getAllAccounts() }

    var selectedAccountPhone by remember {
        mutableStateOf(accounts.firstOrNull()?.phone ?: "")
    }

    var groups by remember {
        mutableStateOf(if (selectedAccountPhone.isNotBlank()) groupStore.getGroupsForAccount(selectedAccountPhone) else emptyList())
    }

    val selectedGroupsCount = groups.count { it.isSelected }

    var messageText by rememberSaveable { mutableStateOf(prefs.draftText) }
    var selectedMediaList by remember { mutableStateOf(PostDraft.media) }
    LaunchedEffect(selectedMediaList) { PostDraft.media = selectedMediaList }
    var delaySeconds by remember { mutableIntStateOf(prefs.postDelaySeconds) }
    var enableRandomDelay by remember { mutableStateOf(prefs.enableRandomDelay) }
    var isTestMode by remember { mutableStateOf(prefs.isTestMode) }
    var validationError by remember { mutableStateOf<String?>(null) }

    val photoPickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.PickMultipleVisualMedia()
    ) { uris: List<Uri> ->
        val newMedia = uris.map { uri ->
            PostMedia(
                uriString = uri.toString(),
                type = MediaType.IMAGE,
                fileName = "photo_${System.currentTimeMillis()}.jpg"
            )
        }
        selectedMediaList = selectedMediaList + newMedia
    }

    val filePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenMultipleDocuments()
    ) { uris: List<Uri> ->
        val newMedia = uris.map { uri ->
            PostMedia(
                uriString = uri.toString(),
                type = MediaType.DOCUMENT,
                fileName = "doc_${System.currentTimeMillis()}"
            )
        }
        selectedMediaList = selectedMediaList + newMedia
    }

    // Helper to copy content uri to cache file
    fun copyUriToCache(uriString: String, name: String): File? {
        return try {
            val uri = Uri.parse(uriString)
            val inputStream = context.contentResolver.openInputStream(uri) ?: return null
            val file = File(context.cacheDir, name)
            FileOutputStream(file).use { out ->
                inputStream.copyTo(out)
            }
            file
        } catch (e: Exception) {
            null
        }
    }

    // Calculation for estimated total time
    val targetCount = if (isTestMode) 1 else selectedGroupsCount
    val totalSeconds = targetCount * delaySeconds
    val totalMinutes = totalSeconds / 60
    val remSec = totalSeconds % 60

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Image(
                            painter = painterResource(id = R.drawable.app_logo),
                            contentDescription = "Logo",
                            modifier = Modifier
                                .size(32.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .border(1.dp, BorderOutline, RoundedCornerShape(8.dp)),
                            contentScale = ContentScale.Fit
                        )
                        Spacer(modifier = Modifier.width(10.dp))
                        Text(
                            text = "ផុសសារស្វ័យប្រវត្តិ (Auto Post)",
                            style = MaterialTheme.typography.titleLarge.copy(fontSize = 18.sp),
                            color = TextDark
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = BackgroundWhite)
            )
        },
        containerColor = BackgroundWhite
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp)
                .verticalScroll(rememberScrollState())
        ) {
            Spacer(modifier = Modifier.height(8.dp))

            // Warning Banner
            Card(
                colors = CardDefaults.cardColors(containerColor = Color(0xFFFEF3C7)),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .border(1.dp, Color(0xFFFDE68A), RoundedCornerShape(12.dp))
            ) {
                Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Warning, contentDescription = null, tint = SkippedOrange)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = stringResource(id = R.string.delay_warning),
                        style = MaterialTheme.typography.bodyMedium.copy(fontSize = 12.sp),
                        color = Color(0xFF92400E)
                    )
                }
            }

            Spacer(modifier = Modifier.height(14.dp))

            // Account and Groups Summary Row
            Card(
                colors = CardDefaults.cardColors(containerColor = SurfaceWhite),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .border(1.dp, BorderOutline, RoundedCornerShape(12.dp))
            ) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Text(
                        text = "គោលដៅផុស (Target)",
                        style = MaterialTheme.typography.titleMedium.copy(fontSize = 14.sp),
                        color = TextDark
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            text = "គណនី: ${if (selectedAccountPhone.isNotBlank()) selectedAccountPhone else "មិនទាន់ជ្រើស"}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = PrimaryBlue
                        )
                        Text(
                            text = if (isTestMode) "Test Mode (Saved Messages)" else "បានជ្រើស $selectedGroupsCount ក្រុម",
                            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold),
                            color = if (selectedGroupsCount > 0 || isTestMode) SuccessGreen else ErrorRed
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(14.dp))

            // Message Text Input
            OutlinedTextField(
                value = messageText,
                onValueChange = {
                    messageText = it
                    prefs.draftText = it
                },
                placeholder = { Text(stringResource(id = R.string.post_content_hint)) },
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 120.dp),
                shape = RoundedCornerShape(12.dp)
            )

            Spacer(modifier = Modifier.height(12.dp))

            // Media Action Buttons
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedButton(
                    onClick = {
                        photoPickerLauncher.launch(
                            PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)
                        )
                    },
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(10.dp),
                    border = androidx.compose.foundation.BorderStroke(1.dp, PrimaryBlue),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = PrimaryBlue)
                ) {
                    Icon(Icons.Default.Photo, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(stringResource(id = R.string.add_photo), fontSize = 13.sp)
                }

                OutlinedButton(
                    onClick = {
                        filePickerLauncher.launch(arrayOf("*/*"))
                    },
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(10.dp),
                    border = androidx.compose.foundation.BorderStroke(1.dp, PrimaryBlue),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = PrimaryBlue)
                ) {
                    Icon(Icons.Default.AttachFile, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(stringResource(id = R.string.add_document), fontSize = 13.sp)
                }
            }

            // Media Preview List
            if (selectedMediaList.isNotEmpty()) {
                Spacer(modifier = Modifier.height(10.dp))
                LazyRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    items(selectedMediaList) { media ->
                        Box(
                            modifier = Modifier
                                .size(80.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .border(1.dp, BorderOutline, RoundedCornerShape(8.dp))
                        ) {
                            if (media.type == MediaType.IMAGE) {
                                AsyncImage(
                                    model = media.uriString,
                                    contentDescription = null,
                                    modifier = Modifier.fillMaxSize(),
                                    contentScale = ContentScale.Crop
                                )
                            } else {
                                Box(
                                    modifier = Modifier
                                        .fillMaxSize()
                                        .background(SurfaceVariantGray),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Icon(Icons.Default.InsertDriveFile, contentDescription = null, tint = PrimaryBlue)
                                }
                            }

                            IconButton(
                                onClick = {
                                    selectedMediaList = selectedMediaList.filterNot { it == media }
                                },
                                modifier = Modifier
                                    .align(Alignment.TopEnd)
                                    .size(24.dp)
                                    .background(Color.Black.copy(alpha = 0.6f), RoundedCornerShape(bottomStart = 8.dp))
                            ) {
                                Icon(Icons.Default.Close, contentDescription = null, tint = Color.White, modifier = Modifier.size(14.dp))
                            }
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Delay & Safety Controls
            Card(
                colors = CardDefaults.cardColors(containerColor = SurfaceWhite),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .border(1.dp, BorderOutline, RoundedCornerShape(12.dp))
            ) {
                Column(modifier = Modifier.padding(14.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "គម្លាតពេលផុស (Delay): $delaySeconds វិនាទី",
                            style = MaterialTheme.typography.titleMedium.copy(fontSize = 14.sp),
                            color = TextDark
                        )
                        if (delaySeconds < 10) {
                            Text("អប្បបរមា 10s!", color = ErrorRed, style = MaterialTheme.typography.labelSmall)
                        }
                    }

                    Slider(
                        value = delaySeconds.toFloat(),
                        onValueChange = {
                            val v = it.toInt()
                            delaySeconds = if (v < 10) 10 else v
                            prefs.postDelaySeconds = delaySeconds
                        },
                        valueRange = 10f..180f,
                        steps = 17,
                        colors = SliderDefaults.colors(
                            thumbColor = PrimaryBlue,
                            activeTrackColor = PrimaryBlue
                        )
                    )

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "បន្ថែមគម្លាតចៃដន្យ (+/- 5 វិនាទី)",
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextDark
                        )
                        Switch(
                            checked = enableRandomDelay,
                            onCheckedChange = {
                                enableRandomDelay = it
                                prefs.enableRandomDelay = it
                            },
                            colors = SwitchDefaults.colors(checkedThumbColor = PrimaryBlue)
                        )
                    }

                    Divider(modifier = Modifier.padding(vertical = 8.dp), color = BorderOutline)

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column {
                            Text(
                                text = "Test Mode (Saved Messages)",
                                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold),
                                color = TextDark
                            )
                            Text(
                                text = "ផ្ញើតេស្តទៅកាន់គណនីផ្ទាល់ខ្លួនសិន",
                                style = MaterialTheme.typography.labelSmall,
                                color = TextSecondary
                            )
                        }
                        Switch(
                            checked = isTestMode,
                            onCheckedChange = {
                                isTestMode = it
                                prefs.isTestMode = it
                            },
                            colors = SwitchDefaults.colors(checkedThumbColor = PrimaryBlue)
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(14.dp))

            // Estimated Time Box
            Card(
                colors = CardDefaults.cardColors(containerColor = SurfaceVariantGray),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier.padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Default.Timer, contentDescription = null, tint = PrimaryBlue)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "ប៉ាន់ស្មានពេលផុសសរុប: $targetCount ក្រុម x $delaySeconds s = ប្រហែល ${totalMinutes} នាទី ${remSec} វិនាទី",
                        style = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.sp),
                        color = TextDark
                    )
                }
            }

            if (validationError != null) {
                Spacer(modifier = Modifier.height(8.dp))
                Text(text = validationError!!, color = ErrorRed, style = MaterialTheme.typography.bodyMedium)
            }

            Spacer(modifier = Modifier.height(18.dp))

            // Big Blue Post Button
            Button(
                onClick = {
                    val activeAcc = accounts.find { it.phone == selectedAccountPhone }
                    if (activeAcc == null) {
                        validationError = "សូមបន្ថែមគណនី Telegram ជាមុនសិន"
                        return@Button
                    }
                    if (messageText.isBlank() && selectedMediaList.isEmpty()) {
                        validationError = "សូមបញ្ចូលសារអត្ថបទ ឬជ្រើសរើសរូបភាព/ឯកសារ"
                        return@Button
                    }
                    if (!isTestMode && selectedGroupsCount == 0) {
                        validationError = "សូមជ្រើសរើសយ៉ាងហោចណាស់ 1 ក្រុមដើម្បីផុស"
                        return@Button
                    }

                    validationError = null
                    val files = selectedMediaList.mapNotNull {
                        copyUriToCache(it.uriString, it.fileName)
                    }

                    postingManager.startCampaign(
                        account = activeAcc,
                        groups = groups,
                        messageText = messageText,
                        mediaFiles = files,
                        delaySeconds = delaySeconds,
                        enableRandom = enableRandomDelay,
                        isTestMode = isTestMode,
                        coroutineScope = coroutineScope
                    )

                    onNavigateToReports()
                },
                colors = ButtonDefaults.buttonColors(containerColor = PrimaryBlue),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(54.dp)
            ) {
                Icon(Icons.Default.Send, contentDescription = null, tint = OnPrimary)
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = stringResource(id = R.string.post_now),
                    style = MaterialTheme.typography.labelLarge.copy(fontSize = 17.sp)
                )
            }

            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}
