import { SafeAreaView, StyleSheet, Text, View } from 'react-native';

export default function App() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.brandMark}>
          <Text style={styles.brandLetter}>C</Text>
        </View>
        <Text style={styles.eyebrow}>CREWFLOW MOBILE</Text>
        <Text style={styles.title}>The field app foundation is ready.</Text>
        <Text style={styles.body}>
          Secure sign-in and assigned jobs arrive after the Phase 1 identity
          boundary is tested.
        </Text>
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Phase 0 shell</Text>
          <Text style={styles.noticeBody}>
            No production data or provider credentials are connected.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: {
    color: '#64748B',
    fontSize: 16,
    lineHeight: 24,
    marginTop: 12,
    maxWidth: 330,
    textAlign: 'center',
  },
  brandLetter: {
    color: '#FFFFFF',
    fontSize: 25,
    fontWeight: '800',
  },
  brandMark: {
    alignItems: 'center',
    backgroundColor: '#1769F4',
    borderRadius: 14,
    height: 56,
    justifyContent: 'center',
    marginBottom: 28,
    transform: [{ rotate: '-4deg' }],
    width: 56,
  },
  container: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 28,
  },
  eyebrow: {
    color: '#1769F4',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.6,
  },
  notice: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 32,
    padding: 18,
    width: '100%',
  },
  noticeBody: {
    color: '#64748B',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 5,
  },
  noticeTitle: {
    color: '#11223C',
    fontSize: 14,
    fontWeight: '700',
  },
  safeArea: {
    backgroundColor: '#F6F8FC',
    flex: 1,
  },
  title: {
    color: '#11223C',
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.8,
    marginTop: 10,
    maxWidth: 340,
    textAlign: 'center',
  },
});
