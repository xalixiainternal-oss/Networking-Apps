package id.pantau.kuota

import android.content.Context
import androidx.room.*
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

/* ─── Tabel 1: ringkasan total per jam per jaringan (v0.2) ─── */
@Entity(tableName = "usage_hour", primaryKeys = ["hourStart", "net"])
data class UsageHour(val hourStart: Long, val net: String, val rx: Long, val tx: Long)

/* ─── Tabel 2: per UID per jam per jaringan (v0.3) ─── */
@Entity(tableName = "app_hour", primaryKeys = ["uid", "hourStart", "net"])
data class AppHour(
    val uid: Int,
    val hourStart: Long,
    val net: String,       // "cell" | "wifi"
    val rx: Long,
    val tx: Long,
    val isFg: Int = 0      // tidak dipakai lagi: rasio fg/bg dibaca langsung dari NetworkStats saat detail dibuka
)

/* ─── Tabel 3: info aplikasi ter-cache (v0.3) ─── */
@Entity(tableName = "app_info", primaryKeys = ["uid"])
data class AppInfo(
    val uid: Int,
    val packageName: String,
    val label: String,
    val isSystem: Int = 0
)

/* ─── Tabel 4: pemakaian tethering/hotspot per jam (v0.4) ─── */
@Entity(tableName = "tether_hour", primaryKeys = ["hourStart", "net"])
data class TetherHour(val hourStart: Long, val net: String, val rx: Long, val tx: Long)

data class AppSummaryRow(val uid: Int, val net: String, val rx: Long, val tx: Long)

@Dao
interface UsageDao {
    // ---------- usage_hour ----------
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun upsert(rows: List<UsageHour>)

    @Query("SELECT * FROM usage_hour WHERE hourStart >= :from AND hourStart < :to ORDER BY hourStart")
    fun range(from: Long, to: Long): List<UsageHour>

    @Query("SELECT COALESCE(SUM(rx + tx), 0) FROM usage_hour WHERE net = :net AND hourStart >= :from AND hourStart < :to")
    fun sumNet(net: String, from: Long, to: Long): Long

    @Query("SELECT MAX(hourStart) FROM usage_hour")
    fun latestHour(): Long?

    @Query("DELETE FROM usage_hour")
    fun clear()

    // ---------- app_hour ----------
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun upsertApp(rows: List<AppHour>)

    @Query("""
        SELECT uid, net, SUM(rx) AS rx, SUM(tx) AS tx
        FROM app_hour
        WHERE hourStart >= :from AND hourStart < :to
        GROUP BY uid, net
    """)
    fun appSummary(from: Long, to: Long): List<AppSummaryRow>

    @Query("""
        SELECT uid, hourStart, net, rx, tx, isFg
        FROM app_hour
        WHERE uid = :uid AND hourStart >= :from AND hourStart < :to
        ORDER BY hourStart
    """)
    fun appHours(uid: Int, from: Long, to: Long): List<AppHour>

    @Query("SELECT COALESCE(SUM(rx + tx), 0) FROM app_hour WHERE uid = :uid AND net = :net AND hourStart >= :from AND hourStart < :to")
    fun sumApp(uid: Int, net: String, from: Long, to: Long): Long

    @Query("SELECT MAX(hourStart) FROM app_hour")
    fun latestAppHour(): Long?

    @Query("DELETE FROM app_hour")
    fun clearApp()

    // ---------- app_info ----------
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun upsertInfo(rows: List<AppInfo>)

    @Query("SELECT * FROM app_info")
    fun allInfo(): List<AppInfo>

    @Query("DELETE FROM app_info")
    fun clearInfo()

    // ---------- tether_hour ----------
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun upsertTether(rows: List<TetherHour>)

    @Query("SELECT * FROM tether_hour WHERE hourStart >= :from AND hourStart < :to ORDER BY hourStart")
    fun tetherRange(from: Long, to: Long): List<TetherHour>

    @Query("SELECT COALESCE(SUM(rx + tx), 0) FROM tether_hour WHERE hourStart >= :from AND hourStart < :to")
    fun sumTether(from: Long, to: Long): Long

    @Query("SELECT COUNT(*) FROM tether_hour")
    fun tetherCount(): Int

    @Query("DELETE FROM tether_hour")
    fun clearTether()
}

@Database(
    entities = [UsageHour::class, AppHour::class, AppInfo::class, TetherHour::class],
    version = 4,
    exportSchema = false
)
abstract class UsageDb : RoomDatabase() {
    abstract fun dao(): UsageDao

    /** Hapus semua riwayat dalam satu transaksi. */
    fun wipe() {
        runInTransaction(Runnable {
            val d = dao()
            d.clear(); d.clearApp(); d.clearInfo(); d.clearTether()
        })
    }

    companion object {
        @Volatile private var inst: UsageDb? = null

        // v0.2 (versi 1) hanya punya usage_hour.
        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("CREATE TABLE IF NOT EXISTS `app_hour` (`uid` INTEGER NOT NULL, `hourStart` INTEGER NOT NULL, `net` TEXT NOT NULL, `rx` INTEGER NOT NULL, `tx` INTEGER NOT NULL, `isFg` INTEGER NOT NULL, PRIMARY KEY(`uid`, `hourStart`, `net`))")
                db.execSQL("CREATE TABLE IF NOT EXISTS `app_info` (`uid` INTEGER NOT NULL, `packageName` TEXT NOT NULL, `label` TEXT NOT NULL, `isSystem` INTEGER NOT NULL, PRIMARY KEY(`uid`))")
            }
        }

        private val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("CREATE TABLE IF NOT EXISTS `tether_hour` (`hourStart` INTEGER NOT NULL, `net` TEXT NOT NULL, `rx` INTEGER NOT NULL, `tx` INTEGER NOT NULL, PRIMARY KEY(`hourStart`, `net`))")
            }
        }

        private val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("CREATE TABLE `app_hour_normalized` (`uid` INTEGER NOT NULL, `hourStart` INTEGER NOT NULL, `net` TEXT NOT NULL, `rx` INTEGER NOT NULL, `tx` INTEGER NOT NULL, `isFg` INTEGER NOT NULL, PRIMARY KEY(`uid`, `hourStart`, `net`))")
                db.execSQL("INSERT INTO `app_hour_normalized` SELECT uid % 100000, hourStart, net, SUM(rx), SUM(tx), MAX(isFg) FROM `app_hour` GROUP BY uid % 100000, hourStart, net")
                db.execSQL("DROP TABLE `app_hour`")
                db.execSQL("ALTER TABLE `app_hour_normalized` RENAME TO `app_hour`")

                db.execSQL("CREATE TABLE `app_info_normalized` (`uid` INTEGER NOT NULL, `packageName` TEXT NOT NULL, `label` TEXT NOT NULL, `isSystem` INTEGER NOT NULL, PRIMARY KEY(`uid`))")
                db.execSQL("INSERT INTO `app_info_normalized` SELECT uid % 100000, MIN(packageName), MIN(label), MAX(isSystem) FROM `app_info` GROUP BY uid % 100000")
                db.execSQL("DROP TABLE `app_info`")
                db.execSQL("ALTER TABLE `app_info_normalized` RENAME TO `app_info`")
            }
        }

        fun get(c: Context): UsageDb = inst ?: synchronized(this) {
            inst ?: Room.databaseBuilder(c.applicationContext, UsageDb::class.java, "usage.db")
                .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4)   // riwayat pengguna tidak boleh hilang saat update
                .fallbackToDestructiveMigrationOnDowngrade()
                .build()
                .also { inst = it }
        }
    }
}
