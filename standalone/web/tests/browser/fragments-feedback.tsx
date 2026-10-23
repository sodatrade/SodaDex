import '../../src/styles.css'
import '../../src/fragments/fragments.css'
import { useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PreferencesProvider } from '../../src/preferences/PreferencesProvider'
import { Dialog } from '../../src/components/Dialog'
import { TransientNotice } from '../../src/fragments/TransientNotice'
function Fixture() {
  const [notice, setNotice] = useState(0)
  const dismiss = useCallback(() => setNotice(0), [])
  return <PreferencesProvider><div className="fragment-shell"><Dialog title="流动性提示测试" onClose={() => {}}><button onClick={() => setNotice(n => n + 1)}>显示提示</button></Dialog>{notice > 0 && <TransientNotice message="请输入有效正数，滑点须小于 100%" id={notice} onDismiss={dismiss}/>}</div></PreferencesProvider>
}
createRoot(document.getElementById('root')!).render(<Fixture/> )
